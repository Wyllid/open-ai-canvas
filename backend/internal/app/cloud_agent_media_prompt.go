package app

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

var cloudAgentMediaMention = regexp.MustCompile(`@(图片|视频|音频)[0-9]+`)

func cloudAgentMediaComposerPrompt(prompt string, refs map[string]any) string {
	labels := map[string]string{}
	for _, kind := range []struct{ field, label string }{
		{"referenceImages", "图片"}, {"referenceVideos", "视频"}, {"referenceAudios", "音频"},
	} {
		for index, ref := range creationMaps(refs[kind.field]) {
			if stringValue(ref["storageKey"]) == "" {
				continue
			}
			label := kind.label
			if kind.field == "referenceImages" && stringValue(ref["canvasReferenceKind"]) == "character" {
				label = "角色"
			}
			// 显示时保留角色类型，编号仍等于实际图片数组的位置。
			labels[fmt.Sprintf("@%s%d", kind.label, index+1)] = fmt.Sprintf("@%s%d", label, index+1)
		}
	}
	return cloudAgentMediaMention.ReplaceAllStringFunc(prompt, func(token string) string {
		if label := labels[token]; label != "" {
			return label
		}
		return token
	})
}

// Slot labels follow each media array's order, matching the canvas editor and
// provider inputs. Text source edges do not consume a media slot.
func cloudAgentMediaReferencePrompt(prompt string, refs map[string]any) (string, error) {
	type reference struct{ token, title string }
	references := []reference{}
	available := map[string]bool{}
	for _, kind := range []struct{ field, label string }{
		{"referenceImages", "图片"}, {"referenceVideos", "视频"}, {"referenceAudios", "音频"},
	} {
		for index, ref := range creationMaps(refs[kind.field]) {
			token := fmt.Sprintf("@%s%d", kind.label, index+1)
			available[token] = true
			// Transient annotation images have no canvas node to render as a chip.
			if stringValue(ref["storageKey"]) == "" {
				continue
			}
			title := strings.Join(strings.Fields(stringValue(ref["name"])), " ")
			title = strings.ReplaceAll(title, "@", "＠")
			if title == "" {
				title = "Untitled reference"
			}
			references = append(references, reference{token, title})
		}
	}
	mentioned := map[string]bool{}
	for _, token := range cloudAgentMediaMention.FindAllString(prompt, -1) {
		if !available[token] {
			return "", BadAuthRequest(fmt.Sprintf("%s in the prompt has no matching reference; fix the reference by the order of each media type in referenceNodeIds", token))
		}
		mentioned[token] = true
	}
	missing := []string{}
	for _, ref := range references {
		if !mentioned[ref.token] {
			missing = append(missing, ref.title+": "+ref.token)
		}
	}
	if len(missing) > 0 {
		prompt += "\n\n[Asset references]\n" + strings.Join(missing, "\n")
	}
	if count := utf8.RuneCountInString(prompt); count > 16000 {
		return "", BadAuthRequest(fmt.Sprintf("With the asset references added, the prompt has %d characters, over the 16000 character limit; shorten the prompt and retry. It is never truncated automatically", count))
	}
	return prompt, nil
}
