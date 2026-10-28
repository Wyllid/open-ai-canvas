// 渠道模型规格档（历史名称 price tier）：选择器规范化与档位能力校验。

package app

import (
	"fmt"
	"strconv"
	"strings"

	"yingce/backend/internal/model"
	protocolcontract "yingce/backend/internal/protocol"
)

func validateChannelModelTierCapabilities(tiers []model.ChannelModelPriceTier, rawCapabilityConfig string, capability string, protocol string) error {
	if capability == "image" {
		config, err := DecodeModelCapabilityConfig(rawCapabilityConfig)
		if err != nil || config == nil || config.Image == nil {
			return BadAuthRequest("图片模型能力配置无效，无法校验规格档规格")
		}
		image := config.Image
		if image.Parameters != nil {
			for _, tier := range tiers {
				if err := validateImageParameterPriceSelector(image.Parameters, tier.Selector); err != nil {
					return err
				}
			}
			return nil
		}
		normalizeLegacyImageResolutionConfig(protocol, image)
		for _, tier := range tiers {
			if value := strings.TrimSpace(tier.Selector["imageResolution"]); value != "" && value != "*" && !image.Resolution.Supported {
				return BadAuthRequest("规格档使用了未启用的图片分辨率条件")
			}
			if value := strings.TrimSpace(tier.Selector["imageResolution"]); value != "" && value != "*" && !containsCapabilityString(image.Resolution.Values, value) {
				return BadAuthRequest("规格档分辨率不在该图片模型支持范围内：" + value)
			}
			if value := strings.TrimSpace(tier.Selector["quality"]); value != "" && value != "*" {
				if image.Quality.Supported {
					if !containsCapabilityString(image.Quality.Values, value) {
						return BadAuthRequest("规格档质量不在该图片模型支持范围内：" + value)
					}
				} else if !legacyImageResolutionProtocol(protocol) || !image.Resolution.Supported || !containsCapabilityString(image.Resolution.Values, value) {
					return BadAuthRequest("规格档使用了未启用的图片质量条件")
				}
			}
		}
		return nil
	}
	if capability != "video" {
		return nil
	}
	config, err := DecodeModelCapabilityConfig(rawCapabilityConfig)
	if err != nil || config == nil || config.Video == nil {
		return BadAuthRequest("视频模型能力配置无效，无法校验规格档规格")
	}
	resolutionSupported := make(map[string]bool, len(config.Video.Resolutions))
	for _, resolution := range config.Video.Resolutions {
		resolutionSupported[normalizeChannelModelTierResolution(resolution)] = true
	}
	// Keep preset prices when narrowing the selected list; tasks use only selected values.
	if config.Video.FixedScreenSpec != nil {
		for _, resolution := range config.Video.FixedScreenSpec.Resolutions {
			resolutionSupported[normalizeChannelModelTierResolution(resolution)] = true
		}
	}
	durationSupported := make(map[int]bool, len(config.Video.Duration.Values))
	for _, seconds := range config.Video.Duration.Values {
		durationSupported[seconds] = true
	}
	for _, tier := range tiers {
		if tier.Resolution != "*" && !resolutionSupported[normalizeChannelModelTierResolution(tier.Resolution)] {
			return BadAuthRequest("规格档分辨率不在该视频模型支持范围内：" + tier.Resolution)
		}
		if tier.VideoSeconds == 0 {
			continue
		}
		if !videoDurationSupported(config.Video) {
			continue
		}
		if config.Video.Duration.Selection == "enum" && !durationSupported[tier.VideoSeconds] {
			return BadAuthRequest(fmt.Sprintf("规格档时长 %d 秒不在该视频模型支持范围内", tier.VideoSeconds))
		}
		if config.Video.Duration.Selection == "range" && (tier.VideoSeconds < config.Video.Duration.Min || tier.VideoSeconds > config.Video.Duration.Max || (config.Video.Duration.Step > 0 && (tier.VideoSeconds-config.Video.Duration.Min)%config.Video.Duration.Step != 0)) {
			return BadAuthRequest(fmt.Sprintf("规格档时长 %d 秒不在该视频模型支持范围内", tier.VideoSeconds))
		}
	}
	return nil
}

// syncLogicalModelsFromChannelModel 只失效路由目录。系统渠道 SKU 与前台模型目录
// 分别维护：保存渠道模型绝不能自动创建、覆盖或删除前台模型及其线路配置。
func (s *Service) syncLogicalModelsFromChannelModel(actor *model.User, channelModel *model.ChannelModel) error {
	_ = actor
	_ = channelModel
	s.invalidateRouteCatalog()
	return nil
}

func (s *Service) normalizeChannelModelPriceTiers(req ChannelModelRequest, capability string, protocol model.ChannelInterfaceType, fallbackProviderModelKey string) ([]model.ChannelModelPriceTier, error) {
	inputs := req.PriceTiers
	// 兼容旧管理 API：没有 priceTiers 的请求等价于一个默认规格档。
	if len(inputs) == 0 {
		enabled := true
		inputs = []ChannelModelPriceTierRequest{{
			Resolution: "*", VideoSeconds: 0, ProviderModelKey: fallbackProviderModelKey,
			Enabled: &enabled,
		}}
	}
	result := make([]model.ChannelModelPriceTier, 0, len(inputs))
	seen := make(map[string]bool, len(inputs))
	for _, input := range inputs {
		var parameters []protocolcontract.ImageParameter
		if req.CapabilityConfig != nil && req.CapabilityConfig.Image != nil {
			parameters = req.CapabilityConfig.Image.Parameters
		}
		selector, resolution, videoSeconds, selectorErr := normalizeChannelModelTierSelector(capability, input, parameters)
		if selectorErr != nil {
			return nil, selectorErr
		}
		_, key, keyErr := model.CanonicalSKUSelector(selector)
		if keyErr != nil {
			return nil, keyErr
		}
		if seen[key] {
			return nil, BadAuthRequest("同一个操作和规格组合只能配置一个规格档")
		}
		seen[key] = true
		id, idErr := s.repo.NextPrefixedID("PTIER")
		if idErr != nil {
			return nil, idErr
		}
		enabled := input.Enabled == nil || *input.Enabled
		result = append(result, model.ChannelModelPriceTier{
			ID:               id,
			SelectorKey:      key,
			SelectorJSON:     key,
			Selector:         selector,
			Resolution:       resolution,
			VideoSeconds:     videoSeconds,
			ProviderModelKey: strings.TrimPrefix(strings.TrimSpace(firstNonEmpty(input.ProviderModelKey, fallbackProviderModelKey)), "models/"),
			Enabled:          enabled,
		})
	}
	return result, nil
}

func normalizeChannelModelTierSelector(capability string, input ChannelModelPriceTierRequest, parameters ...[]protocolcontract.ImageParameter) (map[string]string, string, int, error) {
	if capability == "image" && len(parameters) > 0 && parameters[0] != nil {
		if input.VideoSeconds != 0 || input.Resolution != "" && input.Resolution != "*" {
			return nil, "", 0, BadAuthRequest("图片规格档不接受视频规格")
		}
		selector := make(map[string]string, len(input.Selector))
		for name, value := range input.Selector {
			name, value = strings.TrimSpace(name), strings.TrimSpace(value)
			if name == "" || value == "" || value == "*" {
				continue
			}
			if _, exists := selector[name]; exists {
				return nil, "", 0, BadAuthRequest("规格档存在重复规格条件：" + name)
			}
			selector[name] = value
		}
		if err := validateImageParameterPriceSelector(parameters[0], selector); err != nil {
			return nil, "", 0, err
		}
		return selector, "*", 0, nil
	}
	selector := make(map[string]string, len(input.Selector)+3)
	for rawKey, rawValue := range input.Selector {
		key := strings.TrimSpace(rawKey)
		value := strings.TrimSpace(rawValue)
		if key == "" || value == "" {
			continue
		}
		switch key {
		case "operation":
			value = strings.ToLower(value)
		case "quality", "imageResolution", "size":
			value = strings.ToLower(value)
			if value == "auto" || value == "any" {
				value = "*"
			}
		case "resoluton":
			// Normalize the historical misspelling at the input boundary.
			key = "imageResolution"
			value = strings.ToLower(strings.TrimSpace(value))
			if value == "auto" || value == "any" {
				value = "*"
			}
		case "vquality":
			value = normalizeChannelModelTierResolution(value)
		case "resolution":
			// 兼容图片规格档的标准字段，以及历史接口误拼写 resoluton。
			key = "resolution"
			value = strings.ToLower(strings.TrimSpace(value))
		case "videoSeconds":
			seconds, err := strconv.Atoi(value)
			if err != nil || seconds < 0 {
				return nil, "", 0, BadAuthRequest("视频规格档时长必须是非负整数")
			}
			if seconds == 0 {
				continue
			}
			value = strconv.Itoa(seconds)
		case "imageCount":
			count, err := strconv.Atoi(value)
			if err != nil || count < 0 {
				return nil, "", 0, BadAuthRequest("参考图片数量必须是非负整数")
			}
			if count == 0 {
				continue
			}
			value = strconv.Itoa(count)
		case "videoGenerateAudio":
			if capability != "video" {
				return nil, "", 0, BadAuthRequest("只有视频模型可以按是否生成音频配置规格档")
			}
			value = strings.ToLower(value)
			if value == "*" {
				continue
			}
			if value != "true" && value != "false" {
				return nil, "", 0, BadAuthRequest("视频规格档音频条件必须为 true、false 或 *")
			}
		case "fpsBand":
			if capability != "video" {
				return nil, "", 0, BadAuthRequest("只有视频模型可以按帧率档配置规格档")
			}
			value = strings.ToLower(value)
			if value == "*" {
				continue
			}
			if value != "le30" && value != "le60" && value != "le120" {
				return nil, "", 0, BadAuthRequest("视频规格档帧率条件必须为 le30、le60、le120 或 *")
			}
		default:
			if capability != "image" {
				return nil, "", 0, BadAuthRequest("规格档不支持规格字段：" + key)
			}
		}
		if existing, exists := selector[key]; exists && existing != value {
			return nil, "", 0, BadAuthRequest("规格档存在重复规格条件：" + key)
		}
		selector[key] = value
	}
	if capability == "video" {
		if _, exists := selector["vquality"]; !exists {
			if resolution := normalizeChannelModelTierResolution(input.Resolution); resolution != "*" {
				selector["vquality"] = resolution
			}
		}
		if _, exists := selector["videoSeconds"]; !exists && input.VideoSeconds > 0 {
			selector["videoSeconds"] = strconv.Itoa(input.VideoSeconds)
		}
	} else if input.Resolution != "" && normalizeChannelModelTierResolution(input.Resolution) != "*" {
		return nil, "", 0, BadAuthRequest("非视频模型不能使用视频分辨率规格档")
	} else if input.VideoSeconds != 0 {
		return nil, "", 0, BadAuthRequest("非视频模型不能使用视频时长规格档")
	}
	for _, key := range []string{"quality", "size"} {
		if _, exists := selector[key]; exists && capability != "image" {
			return nil, "", 0, BadAuthRequest("只有图片模型可以按 " + key + " 配置规格档")
		}
	}
	if _, exists := selector["vquality"]; exists && capability != "video" {
		return nil, "", 0, BadAuthRequest("只有视频模型可以按分辨率配置规格档")
	}
	if _, exists := selector["resolution"]; exists && capability != "image" {
		return nil, "", 0, BadAuthRequest("只有图片模型可以按分辨率配置规格档")
	}
	if _, exists := selector["videoSeconds"]; exists && capability != "video" {
		return nil, "", 0, BadAuthRequest("只有视频模型可以按时长配置规格档")
	}
	if _, exists := selector["imageCount"]; exists && capability != "video" {
		return nil, "", 0, BadAuthRequest("只有视频模型可以按参考图片数量配置规格档")
	}
	resolution := "*"
	if value := selector["vquality"]; value != "" {
		resolution = value
	}
	videoSeconds := 0
	if value := selector["videoSeconds"]; value != "" {
		videoSeconds, _ = strconv.Atoi(value)
	}
	return selector, resolution, videoSeconds, nil
}

func normalizeChannelModelTierResolution(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" || value == "*" || strings.EqualFold(value, "any") {
		return "*"
	}
	normalized := normalizeModelRequestOption("vquality", value)
	return strings.ToLower(strings.TrimSpace(fmt.Sprint(normalized)))
}
