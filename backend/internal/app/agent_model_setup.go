package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// The single-admin fork usually needs one text model for the agent. This setup
// writes a normal system channel plus one text channel model, so the agent,
// logical models and the channel admin page all see it the usual way; it only
// saves the admin from assembling the catalog by hand.
const (
	agentModelSetupSettingKey  = "agent_model_setup"
	agentModelSetupChannelName = "Agent model"
	agentModelSetupPromptChars = 200000
	agentModelSetupImageBytes  = 20 << 20
	agentModelSetupMaxImages   = 8
)

var agentModelSetupProtocols = map[string]bool{
	string(model.ChannelInterfaceChatCompletion): true,
	string(model.ChannelInterfaceOpenAIResponse): true,
	string(model.ChannelInterfaceClaudeAPI):      true,
}

type AgentModelSetup struct {
	Configured          bool   `json:"configured"`
	ChannelID           string `json:"channelId,omitempty"`
	ModelID             string `json:"modelId,omitempty"`
	Protocol            string `json:"protocol"`
	BaseURL             string `json:"baseUrl"`
	Model               string `json:"model"`
	HasAPIKey           bool   `json:"hasApiKey"`
	Vision              bool   `json:"vision"`
	ContextWindowTokens int    `json:"contextWindowTokens"`
	MaxOutputTokens     int    `json:"maxOutputTokens"`
	Enabled             bool   `json:"enabled"`
}

type AgentModelSetupRequest struct {
	Protocol string `json:"protocol"`
	BaseURL  string `json:"baseUrl"`
	// APIKey may be empty on an update to keep the stored key.
	APIKey              string `json:"apiKey"`
	Model               string `json:"model"`
	Vision              bool   `json:"vision"`
	ContextWindowTokens int    `json:"contextWindowTokens"`
	MaxOutputTokens     int    `json:"maxOutputTokens"`
}

type agentModelSetupBinding struct {
	ChannelID string `json:"channelId"`
	ModelID   string `json:"modelId"`
}

// AgentModelSetup returns the current quick setup without the API key.
func (s *Service) AgentModelSetup(actor *model.User) (AgentModelSetup, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return AgentModelSetup{}, err
	}
	empty := AgentModelSetup{Protocol: string(model.ChannelInterfaceChatCompletion), ContextWindowTokens: 128000, MaxOutputTokens: 16384}
	binding, err := s.agentModelSetupBinding()
	if err != nil || binding.ChannelID == "" {
		return empty, err
	}
	channel, err := s.repo.AdminSystemChannel(binding.ChannelID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// The channel was deleted from the channel page; the setup starts over.
		return empty, nil
	}
	if err != nil {
		return empty, err
	}
	view := AgentModelSetup{Configured: true, ChannelID: channel.ID, BaseURL: channel.BaseURL, HasAPIKey: strings.TrimSpace(channel.APIKey) != "", Enabled: channel.Enabled, Protocol: empty.Protocol, ContextWindowTokens: empty.ContextWindowTokens, MaxOutputTokens: empty.MaxOutputTokens}
	if binding.ModelID == "" {
		return view, nil
	}
	item, err := s.repo.ChannelModelByID(channel.ID, binding.ModelID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return view, nil
	}
	if err != nil {
		return view, err
	}
	view.ModelID = item.ID
	view.Model = item.ProviderModelKey
	view.Protocol = string(item.Protocol)
	view.Enabled = view.Enabled && item.Enabled
	var config ModelCapabilityConfig
	if json.Unmarshal([]byte(item.CapabilityConfigJSON), &config) == nil && config.Text != nil {
		view.ContextWindowTokens = config.Text.ContextWindowTokens
		view.MaxOutputTokens = config.Text.MaxOutputTokens
		view.Vision = config.Text.References.MaxImages > 0
	}
	return view, nil
}

// SaveAgentModelSetup creates or updates the agent's channel and text model.
func (s *Service) SaveAgentModelSetup(actor *model.User, req AgentModelSetupRequest) (AgentModelSetup, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return AgentModelSetup{}, err
	}
	req.Protocol = strings.TrimSpace(req.Protocol)
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	req.APIKey = strings.TrimSpace(req.APIKey)
	req.Model = strings.TrimPrefix(strings.TrimSpace(req.Model), "models/")
	if !agentModelSetupProtocols[req.Protocol] {
		return AgentModelSetup{}, BadAuthRequest("Choose OpenAI Chat Completions, OpenAI Responses or Anthropic Messages")
	}
	if req.BaseURL == "" {
		return AgentModelSetup{}, BadAuthRequest("Base URL is required")
	}
	if req.Model == "" {
		return AgentModelSetup{}, BadAuthRequest("Model name is required")
	}
	if req.ContextWindowTokens == 0 {
		req.ContextWindowTokens = 128000
	}
	if req.MaxOutputTokens == 0 {
		req.MaxOutputTokens = min(16384, req.ContextWindowTokens/2)
	}
	text := &TextCapabilityConfig{ContextWindowTokens: req.ContextWindowTokens, MaxOutputTokens: req.MaxOutputTokens, References: TextReferenceConfig{PromptMaxChars: agentModelSetupPromptChars}}
	if req.Vision {
		text.References.MaxImages = agentModelSetupMaxImages
		text.References.MaxImageBytes = agentModelSetupImageBytes
	}
	if err := validateTextCapabilityConfig(text); err != nil {
		return AgentModelSetup{}, err
	}

	binding, err := s.agentModelSetupBinding()
	if err != nil {
		return AgentModelSetup{}, err
	}
	enabled := true
	channelReq := ChannelRequest{Name: agentModelSetupChannelName, BaseURL: req.BaseURL, APIKey: req.APIKey, Enabled: &enabled}
	channelID := ""
	if binding.ChannelID != "" {
		if _, lookupErr := s.repo.AdminSystemChannel(binding.ChannelID); lookupErr == nil {
			channelID = binding.ChannelID
		} else if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return AgentModelSetup{}, lookupErr
		}
	}
	if channelID == "" {
		if req.APIKey == "" {
			return AgentModelSetup{}, BadAuthRequest("API key is required")
		}
		created, createErr := s.CreateSystemChannel(actor, channelReq)
		if createErr != nil {
			return AgentModelSetup{}, createErr
		}
		channelID = created.ID
		binding = agentModelSetupBinding{ChannelID: channelID}
	} else if _, updateErr := s.UpdateSystemChannel(actor, channelID, channelReq); updateErr != nil {
		return AgentModelSetup{}, updateErr
	}

	modelID := binding.ModelID
	if modelID != "" {
		if _, lookupErr := s.repo.ChannelModelByID(channelID, modelID); errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			modelID = ""
		} else if lookupErr != nil {
			return AgentModelSetup{}, lookupErr
		}
	}
	item, err := s.SaveAdminChannelModel(actor, channelID, modelID, ChannelModelRequest{
		ModelKey:         req.Model,
		ProviderModelKey: req.Model,
		DisplayName:      req.Model,
		Description:      "Created by the agent model setup.",
		Capability:       "text",
		Protocol:         req.Protocol,
		Enabled:          &enabled,
		CapabilityConfig: &ModelCapabilityConfig{Version: 1, Text: text},
	})
	if err != nil {
		return AgentModelSetup{}, err
	}
	if err := s.saveAgentModelSetupBinding(actor, agentModelSetupBinding{ChannelID: channelID, ModelID: item.ID}); err != nil {
		return AgentModelSetup{}, err
	}
	return s.AgentModelSetup(actor)
}

func (s *Service) agentModelSetupBinding() (agentModelSetupBinding, error) {
	setting, err := s.repo.SystemSettingOptional(agentModelSetupSettingKey)
	if err != nil || setting == nil {
		return agentModelSetupBinding{}, err
	}
	var binding agentModelSetupBinding
	if err := json.Unmarshal([]byte(setting.ValueJSON), &binding); err != nil {
		// A damaged value only loses the link to the channel; the channel stays.
		return agentModelSetupBinding{}, nil
	}
	return binding, nil
}

func (s *Service) saveAgentModelSetupBinding(actor *model.User, binding agentModelSetupBinding) error {
	encoded, err := json.Marshal(binding)
	if err != nil {
		return err
	}
	now := time.Now()
	setting := &model.SystemSetting{Key: agentModelSetupSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID, UpdatedAt: now}
	if existing, err := s.repo.SystemSettingOptional(agentModelSetupSettingKey); err != nil {
		return err
	} else if existing != nil {
		setting.CreatedAt = existing.CreatedAt
	} else {
		setting.CreatedAt = now
	}
	return s.repo.SaveSystemSetting(setting)
}
