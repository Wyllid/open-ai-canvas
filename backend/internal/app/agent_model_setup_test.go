package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestSaveAgentModelSetupCreatesThenUpdatesOneChannel(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	svc.dataDir = t.TempDir()
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}

	empty, err := svc.AgentModelSetup(admin)
	if err != nil || empty.Configured {
		t.Fatalf("empty setup = %+v, %v", empty, err)
	}
	if _, err := svc.SaveAgentModelSetup(admin, AgentModelSetupRequest{Protocol: "chat-completion", BaseURL: "https://8.8.8.8/v1", Model: "gpt-test"}); err == nil {
		t.Fatal("first save without an API key must fail")
	}
	if _, err := svc.SaveAgentModelSetup(admin, AgentModelSetupRequest{Protocol: "openai-image", BaseURL: "https://8.8.8.8/v1", APIKey: "synthetic", Model: "gpt-test"}); err == nil {
		t.Fatal("a non-text protocol must be refused")
	}

	first, err := svc.SaveAgentModelSetup(admin, AgentModelSetupRequest{Protocol: "chat-completion", BaseURL: "https://8.8.8.8/v1/", APIKey: "synthetic", Model: "gpt-test", Vision: true})
	if err != nil {
		t.Fatal(err)
	}
	if !first.Configured || !first.HasAPIKey || !first.Enabled || !first.Vision || first.Model != "gpt-test" || first.BaseURL != "https://8.8.8.8/v1" || first.ContextWindowTokens != 128000 {
		t.Fatalf("first setup = %+v", first)
	}

	second, err := svc.SaveAgentModelSetup(admin, AgentModelSetupRequest{Protocol: "claude-api", BaseURL: "https://8.8.4.4", Model: "claude-test", ContextWindowTokens: 200000, MaxOutputTokens: 32000})
	if err != nil {
		t.Fatal(err)
	}
	if second.ChannelID != first.ChannelID || second.ModelID != first.ModelID || second.Protocol != "claude-api" || second.Model != "claude-test" || !second.HasAPIKey || second.Vision || second.MaxOutputTokens != 32000 {
		t.Fatalf("second setup = %+v (first %+v)", second, first)
	}
	var channels, models int64
	db.Model(&model.ModelChannel{}).Count(&channels)
	db.Model(&model.ChannelModel{}).Where("channel_id = ?", first.ChannelID).Count(&models)
	if channels != 1 || models != 1 {
		t.Fatalf("channels=%d models=%d, want 1 and 1", channels, models)
	}
}

func TestAgentModelSetupRequiresAdmin(t *testing.T) {
	svc, _ := newChannelModelTestService(t)
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	if _, err := svc.AgentModelSetup(user); err == nil {
		t.Fatal("non-admin read must fail")
	}
	if _, err := svc.SaveAgentModelSetup(user, AgentModelSetupRequest{}); err == nil {
		t.Fatal("non-admin save must fail")
	}
}
