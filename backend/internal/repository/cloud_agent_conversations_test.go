package repository

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestCloudAgentConversationAdmissionAcrossConnections(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		{
			t.Run(driver, func(t *testing.T) {
				config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
				var dialector gorm.Dialector = sqlite.Open(filepath.Join(t.TempDir(), "conversation.db") + "?_journal_mode=WAL&_busy_timeout=5000")
				if driver == "postgres" {
					dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
					if dsn == "" {
						t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
					}
					admin, err := gorm.Open(postgres.Open(dsn), config)
					if err != nil {
						t.Fatal(err)
					}
					schema := fmt.Sprintf("agent_conversation_%d", time.Now().UnixNano())
					if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() {
						if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
							t.Error(err)
						}
						conn, _ := admin.DB()
						_ = conn.Close()
					})
					parsed, err := url.Parse(dsn)
					if err != nil {
						t.Fatal(err)
					}
					query := parsed.Query()
					query.Set("search_path", schema)
					parsed.RawQuery = query.Encode()
					dialector = postgres.Open(parsed.String())
				}
				open := func() *Repository {
					db, err := gorm.Open(dialector, config)
					if err != nil {
						t.Fatal(err)
					}
					conn, err := db.DB()
					if err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() { _ = conn.Close() })
					return New(db)
				}
				a, b := open(), open()
				testCloudAgentConversationAdmission(t, a, b)
			})
		}
	}
}

func testCloudAgentConversationAdmission(t *testing.T, a, b *Repository) {
	t.Helper()
	if err := a.db.AutoMigrate(&model.Task{}, &model.CloudAgentExecution{}, &model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range []any{
		&model.CloudAgentExecution{ID: "parent", UserID: "user", ConversationID: "parent", Status: "completed", Revision: 7},
		&model.CanvasProject{ID: "canvas-a", UserID: "user"},
		&model.CanvasProject{ID: "canvas-b", UserID: "user"},
	} {
		if err := a.db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	input, _ := json.Marshal(map[string]any{"cloudAgent": map[string]string{"parentId": "parent"}})
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i, repo := range []*Repository{a, b} {
		wg.Add(1)
		go func(i int, repo *Repository) {
			defer wg.Done()
			<-start
			task := &model.Task{ID: fmt.Sprintf("child-%d", i), UserID: "user", ProjectID: fmt.Sprintf("canvas-%c", 'a'+i), Operation: "cloud_agent", Status: model.TaskStatusTextReplay, InputJSON: string(input)}
			results <- repo.CreateTaskWithActiveLimit(task, 100)
		}(i, repo)
	}
	close(start)
	wg.Wait()
	close(results)
	accepted, stale := 0, 0
	for err := range results {
		switch {
		case err == nil:
			accepted++
		case errors.Is(err, ErrCloudAgentStaleParent):
			stale++
		default:
			t.Fatalf("unexpected admission result: %v", err)
		}
	}
	if accepted != 1 || stale != 1 {
		t.Fatalf("same parent branched across canvases: accepted=%d stale=%d", accepted, stale)
	}
	var tasks int64
	if err := a.db.Model(&model.Task{}).Count(&tasks).Error; err != nil || tasks != 1 {
		t.Fatalf("task count=%d %v", tasks, err)
	}
	var parent model.CloudAgentExecution
	if err := a.db.First(&parent, "id = ?", "parent").Error; err != nil || parent.Revision != 7 {
		t.Fatalf("admission changed parent checkpoint: %+v %v", parent, err)
	}
}
