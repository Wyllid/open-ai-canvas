package app

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

const cloudAgentProfileMaxRunes = 12000

type AgentProfileRequest struct {
	Scope     string `json:"scope"`
	ProjectID string `json:"projectId,omitempty"`
	CanvasID  string `json:"canvasId,omitempty"`
	Content   string `json:"content"`
	Revision  int64  `json:"revision"`
}

type AgentProfileLayer struct {
	Scope     string `json:"scope"`
	ProjectID string `json:"projectId,omitempty"`
	CanvasID  string `json:"canvasId,omitempty"`
	Content   string `json:"content"`
	Revision  int64  `json:"revision"`
	Hash      string `json:"hash"`
}

type AgentProfileView struct {
	Revision string              `json:"revision"`
	Hash     string              `json:"hash"`
	Layers   []AgentProfileLayer `json:"layers"`
}

func validateAgentProfileContent(content string) error {
	if !utf8.ValidString(content) || utf8.RuneCountInString(content) > cloudAgentProfileMaxRunes {
		return BadAuthRequest("The Agent preference document must be valid UTF-8 and at most 12000 characters")
	}
	for _, r := range content {
		if unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' {
			return BadAuthRequest("The Agent preference document must not contain control characters")
		}
	}
	return nil
}

func validateAgentProfileScope(req AgentProfileRequest) error {
	if req.Scope != model.AgentProfileScopeUser && req.Scope != model.AgentProfileScopeProject && req.Scope != model.AgentProfileScopeCanvas {
		return BadAuthRequest("Invalid Agent preference scope")
	}
	if req.Scope == model.AgentProfileScopeUser && (req.ProjectID != "" || req.CanvasID != "") {
		return BadAuthRequest("User preferences cannot carry a project or canvas ID")
	}
	if req.Scope == model.AgentProfileScopeProject && (req.ProjectID == "" || req.CanvasID != "") {
		return BadAuthRequest("Project preferences need projectId and cannot carry canvasId")
	}
	if req.Scope == model.AgentProfileScopeCanvas && req.CanvasID == "" {
		return BadAuthRequest("Canvas preferences are missing canvasId")
	}
	if req.ProjectID != "" {
		if err := validateCloudAgentID(req.ProjectID, "Project ID", 80); err != nil {
			return err
		}
	}
	if req.CanvasID != "" {
		if err := validateCloudAgentID(req.CanvasID, "Canvas ID", 80); err != nil {
			return err
		}
	}
	if req.Revision < 0 {
		return BadAuthRequest("Invalid preference revision")
	}
	return validateAgentProfileContent(req.Content)
}

func agentProfileHash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

func agentProfileRevision(layers []AgentProfileLayer) string {
	var b strings.Builder
	for _, layer := range layers {
		b.WriteString(layer.Scope)
		b.WriteByte(0)
		b.WriteString(layer.ProjectID)
		b.WriteByte(0)
		b.WriteString(layer.CanvasID)
		b.WriteByte(0)
		b.WriteString(layer.Hash)
		b.WriteByte(0)
	}
	return agentProfileHash(b.String())
}

func (s *Service) UpdateCloudAgentProfile(userID string, req AgentProfileRequest) (AgentProfileView, error) {
	if userID == "" {
		return AgentProfileView{}, kernel.Unauthorized("Please sign in first")
	}
	if err := validateAgentProfileScope(req); err != nil {
		return AgentProfileView{}, err
	}
	projectID, canvasID := req.ProjectID, req.CanvasID
	if req.Scope == model.AgentProfileScopeProject {
		if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
			return AgentProfileView{}, err
		}
	}
	if req.Scope == model.AgentProfileScopeCanvas {
		canvas, err := s.repo.CanvasProjectForUser(userID, canvasID)
		if err != nil {
			return AgentProfileView{}, err
		}
		if projectID != "" && canvas.ProjectID != projectID {
			return AgentProfileView{}, errors.New("The canvas does not belong to the given project")
		}
		projectID = canvas.ProjectID
	}
	if req.Scope != model.AgentProfileScopeCanvas {
		canvasID = ""
	}
	content := strings.TrimSpace(req.Content)
	profile := &model.AgentProfile{
		ID: newID(), UserID: userID, Scope: req.Scope, ProjectID: projectID, CanvasID: canvasID,
		Content: content, Revision: 1, Hash: agentProfileHash(content), UpdatedAt: time.Now(),
	}
	if err := s.repo.SaveAgentProfile(profile, req.Revision); err != nil {
		if errors.Is(err, repository.ErrTaskStateConflict) {
			return AgentProfileView{}, creationConflict("Agent preferences changed; reload them and save again")
		}
		return AgentProfileView{}, err
	}
	return s.cloudAgentProfileView(userID, projectID, canvasID)
}

// CloudAgentProfile returns the effective user/project/canvas preferences for a canvas.
func (s *Service) CloudAgentProfile(userID, canvasID string) (AgentProfileView, error) {
	return s.cloudAgentProfileView(userID, "", canvasID)
}

// CloudAgentProfileForScope returns the effective preference layers for the requested scope.
// The returned revision/hash identify the exact merged document that must be fixed into a run.
func (s *Service) CloudAgentProfileForScope(userID, projectID, canvasID string) (AgentProfileView, error) {
	return s.cloudAgentProfileView(userID, projectID, canvasID)
}

func (s *Service) cloudAgentProfileView(userID, projectID, canvasID string) (AgentProfileView, error) {
	if userID == "" {
		return AgentProfileView{}, kernel.Unauthorized("Please sign in first")
	}
	if projectID != "" {
		if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
			return AgentProfileView{}, err
		}
	}
	if canvasID != "" {
		canvas, err := s.repo.CanvasProjectForUser(userID, canvasID)
		if err != nil {
			return AgentProfileView{}, err
		}
		if projectID != "" && canvas.ProjectID != projectID {
			return AgentProfileView{}, errors.New("The canvas does not belong to the given project")
		}
		projectID = canvas.ProjectID
	}
	layers := []AgentProfileLayer{}
	appendProfile := func(profile *model.AgentProfile, scope string) {
		if profile == nil {
			return
		}
		layers = append(layers, AgentProfileLayer{Scope: scope, ProjectID: profile.ProjectID, CanvasID: profile.CanvasID, Content: profile.Content, Revision: profile.Revision, Hash: profile.Hash})
	}
	user, err := s.repo.AgentProfile(userID, model.AgentProfileScopeUser, "", "")
	if err == nil {
		appendProfile(user, model.AgentProfileScopeUser)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return AgentProfileView{}, err
	}
	if projectID != "" {
		project, err := s.repo.AgentProfile(userID, model.AgentProfileScopeProject, projectID, "")
		if err == nil {
			appendProfile(project, model.AgentProfileScopeProject)
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return AgentProfileView{}, err
		}
	}
	if canvasID != "" {
		canvasProfile, err := s.repo.AgentProfile(userID, model.AgentProfileScopeCanvas, projectID, canvasID)
		if err == nil {
			appendProfile(canvasProfile, model.AgentProfileScopeCanvas)
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return AgentProfileView{}, err
		}
	}
	text := agentProfileText(layers)
	return AgentProfileView{Revision: agentProfileRevision(layers), Hash: agentProfileHash(text), Layers: layers}, nil
}

func agentProfileText(layers []AgentProfileLayer) string {
	var text strings.Builder
	for _, layer := range layers {
		if strings.TrimSpace(layer.Content) == "" {
			continue
		}
		text.WriteString("\n## ")
		text.WriteString(layer.Scope)
		text.WriteString(" profile\n")
		text.WriteString(layer.Content)
		text.WriteByte('\n')
	}
	return strings.TrimSpace(text.String())
}

func (s *Service) cloudAgentProfileSnapshot(userID, canvasID string) (cloudAgentProfileSnapshot, error) {
	view, err := s.CloudAgentProfile(userID, canvasID)
	if err != nil {
		return cloudAgentProfileSnapshot{}, err
	}
	layers := make([]AgentProfileLayer, len(view.Layers))
	copy(layers, view.Layers)
	return cloudAgentProfileSnapshot{Revision: view.Revision, Hash: view.Hash, Layers: layers}, nil
}

func validateCloudAgentProfileSnapshot(profile cloudAgentProfileSnapshot, policy cloudAgentPolicySnapshot) error {
	if profile.Revision != policy.ProfileRevision || profile.Hash != policy.ProfileHash {
		return errors.New("Agent runtime profile does not match admitted policy")
	}
	order := map[string]int{model.AgentProfileScopeUser: 0, model.AgentProfileScopeProject: 1, model.AgentProfileScopeCanvas: 2}
	last, seen := -1, map[string]bool{}
	for _, layer := range profile.Layers {
		position, ok := order[layer.Scope]
		if !ok || seen[layer.Scope] || position <= last || layer.Revision <= 0 {
			return errors.New("Agent runtime profile layers are invalid")
		}
		switch layer.Scope {
		case model.AgentProfileScopeUser:
			if layer.ProjectID != "" || layer.CanvasID != "" {
				return errors.New("Agent runtime user profile scope is invalid")
			}
		case model.AgentProfileScopeProject:
			if layer.ProjectID == "" || layer.CanvasID != "" {
				return errors.New("Agent runtime project profile scope is invalid")
			}
		case model.AgentProfileScopeCanvas:
			if layer.ProjectID == "" || layer.CanvasID == "" {
				return errors.New("Agent runtime canvas profile scope is invalid")
			}
		}
		if err := validateAgentProfileContent(layer.Content); err != nil || layer.Hash != agentProfileHash(layer.Content) {
			return errors.New("Agent runtime profile content is invalid")
		}
		seen[layer.Scope], last = true, position
	}
	if profile.Revision != agentProfileRevision(profile.Layers) || profile.Hash != agentProfileHash(agentProfileText(profile.Layers)) {
		return errors.New("Agent runtime profile snapshot is inconsistent")
	}
	return nil
}
