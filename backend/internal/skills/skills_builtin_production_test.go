package skills

import (
	"testing"

	"yingce/backend/builtin"
)

func TestProductionSkillsLoad(t *testing.T) {
	packages, err := loadBuiltinSkillPackagesFromFS(builtin.FS, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{"oac-segment-continuity": false, "oac-production-review-passes": false, "oac-music-direction": false}
	for _, item := range packages {
		if _, ok := want[item.skill.ID]; ok {
			want[item.skill.ID] = true
			if item.skill.Name == "" || item.skill.Description == "" || len(item.archive.Files["SKILL.md"]) == 0 {
				t.Errorf("skill %s loaded without name, description or body", item.skill.ID)
			}
		}
	}
	for id, found := range want {
		if !found {
			t.Errorf("built-in skill %s did not load", id)
		}
	}
}
