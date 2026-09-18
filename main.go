package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// User represents the data stored in DB
type User struct {
	ID            string    `json:"id"`             // SHA256(Key)
	Name          string    `json:"name"`           // User Name
	ContactName   string    `json:"contact_name"`   // Emergency Contact Name
	ContactMethod string    `json:"contact_method"` // Emergency Contact Method
	Note          string    `json:"note"`           // User Note
	Period        string    `json:"period"`         // Check-in period (24h, 48h, etc)
	LastCheckin   time.Time `json:"last_checkin"`
	CreatedAt     time.Time `json:"created_at"`
}

type AdminUser struct {
	User
	IsOverdue       bool
	OverdueDuration string
}

var db *sql.DB

func initDB() {
	var err error
	// Ensure the db file is in the current directory or op subdirectory
	// Check if data directory exists, if so use it (for Docker)
	dbPath := "users.db"
	if _, err := os.Stat("data"); err == nil {
		dbPath = "data/users.db"
	}
	
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS users (
		"id" TEXT NOT NULL PRIMARY KEY,
		"name" TEXT,
		"contact_name" TEXT,
		"contact_method" TEXT,
		"note" TEXT,
		"period" TEXT,
		"last_checkin" DATETIME,
		"created_at" DATETIME
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	// Serve static files
	fs := http.FileServer(http.Dir("."))
	http.Handle("/", fs)

	// API Endpoints
	http.HandleFunc("/api/register", handleRegister)
	http.HandleFunc("/api/login", handleLogin)
	http.HandleFunc("/api/checkin", handleCheckin)
	http.HandleFunc("/api/update_period", handleUpdatePeriod)
	http.HandleFunc("/api/delete", handleDelete)
	http.HandleFunc("/api/sos", handleSOS)
	http.HandleFunc("/baby", handleAdmin)

	port := "19999"
	fmt.Printf("Server starting on http://localhost:%s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID            string `json:"id"`
		EncryptedData string `json:"encrypted_data"`
		Key           string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Decrypt data on server side
	decryptedData, err := decryptData(req.EncryptedData, req.Key)
	if err != nil {
		http.Error(w, "Failed to decrypt data: "+err.Error(), http.StatusBadRequest)
		return
	}

	var userData struct {
		Name          string `json:"name"`
		ContactName   string `json:"contact_name"`
		ContactMethod string `json:"contact_method"`
		Note          string `json:"note"`
		Period        string `json:"period"`
	}
	if err := json.Unmarshal(decryptedData, &userData); err != nil {
		http.Error(w, "Invalid decrypted JSON", http.StatusBadRequest)
		return
	}

	var u User
	u.ID = req.ID
	u.Name = userData.Name
	u.ContactName = userData.ContactName
	u.ContactMethod = userData.ContactMethod
	u.Note = userData.Note
	u.Period = userData.Period
	u.CreatedAt = time.Now()
	u.LastCheckin = time.Now()

	stmt, err := db.Prepare("INSERT INTO users(id, name, contact_name, contact_method, note, period, last_checkin, created_at) values(?, ?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer stmt.Close()

	_, err = stmt.Exec(u.ID, u.Name, u.ContactName, u.ContactMethod, u.Note, u.Period, u.LastCheckin, u.CreatedAt)
	if err != nil {
		// Check for unique constraint violation (user already exists)
		http.Error(w, "User already exists or database error", http.StatusConflict)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// Helper functions for decryption
func decryptData(encryptedStr, keyStr string) ([]byte, error) {
	parts := strings.Split(encryptedStr, ":")
	if len(parts) != 2 {
		return nil, errors.New("invalid encrypted format")
	}

	iv, err := hex.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}
	ciphertext, err := hex.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}

	// Derive AES key from keyStr using SHA256 (same as frontend)
	hash := sha256.Sum256([]byte(keyStr))
	key := hash[:]

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	plaintext, err := aesgcm.Open(nil, iv, ciphertext, nil)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var u User
	row := db.QueryRow("SELECT id, name, contact_name, contact_method, note, period, last_checkin FROM users WHERE id = ?", req.ID)
	err := row.Scan(&u.ID, &u.Name, &u.ContactName, &u.ContactMethod, &u.Note, &u.Period, &u.LastCheckin)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "User not found", http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(u)
}

func handleCheckin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	stmt, err := db.Prepare("UPDATE users SET last_checkin = ? WHERE id = ?")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer stmt.Close()

	res, err := stmt.Exec(time.Now(), req.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := res.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "success", "time": time.Now().Format(time.RFC3339)})
}

func handleUpdatePeriod(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID     string `json:"id"`
		Period string `json:"period"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	stmt, err := db.Prepare("UPDATE users SET period = ? WHERE id = ?")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer stmt.Close()

	res, err := stmt.Exec(req.Period, req.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := res.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func handleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	stmt, err := db.Prepare("DELETE FROM users WHERE id = ?")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer stmt.Close()

	res, err := stmt.Exec(req.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := res.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

func handleSOS(w http.ResponseWriter, r *http.Request) {
	var name, contactName, contactMethod, note string

	if r.Method == http.MethodPost {
		// Try parsing JSON first
		var req struct {
			Name          string `json:"name"`
			ContactName   string `json:"contact_name"`
			ContactMethod string `json:"contact_method"`
			Note          string `json:"note"`
		}
		
		// If Content-Type is application/json, try decoding
		if strings.Contains(r.Header.Get("Content-Type"), "application/json") {
			if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
				name = req.Name
				contactName = req.ContactName
				contactMethod = req.ContactMethod
				note = req.Note
			}
		}
		
		// If JSON parsing failed or fields are empty, try Form values
		if name == "" {
			name = r.FormValue("name")
			contactName = r.FormValue("contact_name")
			contactMethod = r.FormValue("contact_method")
			note = r.FormValue("note")
		}
	} else if r.Method == http.MethodGet {
		name = r.URL.Query().Get("name")
		contactName = r.URL.Query().Get("contact_name")
		contactMethod = r.URL.Query().Get("contact_method")
		note = r.URL.Query().Get("note")
	} else {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Validate required fields
	if name == "" || contactName == "" || contactMethod == "" {
		http.Error(w, "Missing required fields: name, contact_name, contact_method", http.StatusBadRequest)
		return
	}

	// Generate ID: api_ + timestamp_nanos
	id := fmt.Sprintf("api_%d", time.Now().UnixNano())

	stmt, err := db.Prepare("INSERT INTO users(id, name, contact_name, contact_method, note, period, last_checkin, created_at) values(?, ?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer stmt.Close()

	// Set period to "ALERT" and last_checkin to a time that ensures overdue
	_, err = stmt.Exec(id, name, contactName, contactMethod, note, "ALERT", time.Now().Add(-24*time.Hour), time.Now())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"status": "success", "id": id})
}

func handleAdmin(w http.ResponseWriter, r *http.Request) {
	sessionToken := os.Getenv("ADMIN_SESSION_TOKEN")
	expectedUsername := os.Getenv("ADMIN_USERNAME")
	expectedPassword := os.Getenv("ADMIN_PASSWORD")

	// Check for logout
	if r.URL.Query().Get("action") == "logout" {
		http.SetCookie(w, &http.Cookie{
			Name:   "admin_session",
			Value:  "",
			Path:   "/",
			MaxAge: -1,
		})
		http.Redirect(w, r, "/baby", http.StatusSeeOther)
		return
	}

	// Check login status via Cookie
	isLoggedIn := false
	cookie, err := r.Cookie("admin_session")
	if err == nil && sessionToken != "" && subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(sessionToken)) == 1 {
		isLoggedIn = true
	}

	// Handle Login POST or Delete POST
	var errorMsg string
	if r.Method == http.MethodPost {
		action := r.FormValue("action")
		if action == "login" {
			user := r.FormValue("username")
			pass := r.FormValue("password")
			if sessionToken != "" && expectedUsername != "" && expectedPassword != "" &&
				subtle.ConstantTimeCompare([]byte(user), []byte(expectedUsername)) == 1 &&
				subtle.ConstantTimeCompare([]byte(pass), []byte(expectedPassword)) == 1 {
				http.SetCookie(w, &http.Cookie{
					Name:     "admin_session",
					Value:    sessionToken,
					Path:     "/",
					HttpOnly: true,
					SameSite: http.SameSiteLaxMode,
					Secure:   r.TLS != nil,
				})
				http.Redirect(w, r, "/baby", http.StatusSeeOther)
				return
			} else {
				errorMsg = "账号或密码错误"
			}
		} else if action == "delete" && isLoggedIn {
			id := r.FormValue("id")
			if id != "" {
				stmt, err := db.Prepare("DELETE FROM users WHERE id = ?")
				if err == nil {
					stmt.Exec(id)
					stmt.Close()
				}
				http.Redirect(w, r, "/baby", http.StatusSeeOther)
				return
			}
		}
	}

	data := struct {
		IsLoggedIn bool
		Users      []AdminUser
		Error      string
	}{
		IsLoggedIn: isLoggedIn,
		Error:      errorMsg,
	}

	if isLoggedIn {
		rows, err := db.Query("SELECT id, name, contact_name, contact_method, note, period, last_checkin, created_at FROM users ORDER BY created_at DESC")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		for rows.Next() {
			var u User
			if err := rows.Scan(&u.ID, &u.Name, &u.ContactName, &u.ContactMethod, &u.Note, &u.Period, &u.LastCheckin, &u.CreatedAt); err != nil {
				continue
			}

			au := AdminUser{User: u}
			au.IsOverdue, au.OverdueDuration = checkOverdue(u.LastCheckin, u.Period)
			data.Users = append(data.Users, au)
		}
	}

	tmpl, err := template.ParseFiles("admin.html")
	if err != nil {
		http.Error(w, "Template error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tmpl.Execute(w, data); err != nil {
		http.Error(w, "Render error: "+err.Error(), http.StatusInternalServerError)
	}
}

func checkOverdue(lastCheckin time.Time, periodStr string) (bool, string) {
	var duration time.Duration
	switch periodStr {
	case "ALERT":
		return true, "外部触发"
	case "24h":
		duration = 24 * time.Hour
	case "48h":
		duration = 48 * time.Hour
	case "72h":
		duration = 72 * time.Hour
	case "1w":
		duration = 7 * 24 * time.Hour
	default:
		duration = 24 * time.Hour
	}

	diff := time.Since(lastCheckin)
	if diff > duration {
		overdue := diff - duration
		// Format duration
		hours := int(overdue.Hours())
		minutes := int(overdue.Minutes()) % 60
		return true, fmt.Sprintf("%dh %dm", hours, minutes)
	}
	return false, ""
}
