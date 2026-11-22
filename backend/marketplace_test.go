package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

type testAPI struct {
	origin string
	client *http.Client
}

func integrationAPI(t *testing.T) testAPI {
	t.Helper()
	origin := os.Getenv("TEST_WEB_ORIGIN")
	if origin == "" {
		t.Skip("set TEST_WEB_ORIGIN to a running demo")
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return testAPI{strings.TrimRight(origin, "/"), &http.Client{Jar: jar, Timeout: 10 * time.Second}}
}

func (a testAPI) request(method, path string, body any) (int, []byte, error) {
	var data io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		data = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, a.origin+"/api"+path, data)
	if err != nil {
		return 0, nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Game-Market-Request", "1")
	result, err := a.client.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer result.Body.Close()
	raw, err := io.ReadAll(result.Body)
	return result.StatusCode, raw, err
}

func (a testAPI) expect(t *testing.T, method, path string, body any, status int, output any) {
	t.Helper()
	code, raw, err := a.request(method, path, body)
	if err != nil {
		t.Fatal(err)
	}
	if code != status {
		t.Fatalf("%s %s: status %d, want %d (%s)", method, path, code, status, raw)
	}
	if output != nil {
		if err := json.Unmarshal(raw, output); err != nil {
			t.Fatal(err)
		}
	}
}

func (a testAPI) register(t *testing.T) map[string]string {
	t.Helper()
	login := map[string]string{"email": fmt.Sprintf("go-test-%d@example.test", time.Now().UnixNano()), "password": "test-password-123"}
	a.expect(t, "POST", "/auth/register", login, 201, nil)
	return login
}

func TestAuthenticationLifecycle(t *testing.T) {
	api := integrationAPI(t)
	api.expect(t, "GET", "/account/orders", nil, 401, nil)
	credentials := api.register(t)
	api.expect(t, "GET", "/auth/me", nil, 200, nil)
	api.expect(t, "POST", "/auth/logout", nil, 204, nil)
	api.expect(t, "GET", "/account/orders", nil, 401, nil)
	api.expect(t, "POST", "/auth/login", map[string]string{"email": credentials["email"], "password": "wrong-password"}, 401, nil)
	api.expect(t, "POST", "/auth/login", credentials, 200, nil)
	api.expect(t, "GET", "/account/orders", nil, 200, nil)
}

func TestSessionCookieFlags(t *testing.T) {
	for _, secure := range []bool{false, true} {
		cookie := (authHandler{secure: secure}).cookie("test", time.Now(), 60)
		if !cookie.HttpOnly || cookie.Secure != secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" {
			t.Fatalf("unexpected flags for secure=%v: %s", secure, cookie)
		}
	}
}

func TestConfiguredOriginPolicy(t *testing.T) {
	handler := originPolicy("https://demo.example")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))
	for _, tc := range []struct {
		origin string
		status int
	}{
		{"https://demo.example", 200}, {"https://other.example", 403},
	} {
		request := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
		request.Header.Set("Origin", tc.origin)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != tc.status {
			t.Fatalf("origin %s: got %d, want %d", tc.origin, response.Code, tc.status)
		}
	}
}

func TestDiscountAndLastKeyCheckout(t *testing.T) {
	seller := integrationAPI(t)
	first := integrationAPI(t)
	second := integrationAPI(t)
	seller.register(t)
	first.register(t)
	second.register(t)

	var item struct{ ID string }
	seller.expect(t, "POST", "/account/items", map[string]any{
		"title":       fmt.Sprintf("Go checkout demo %d", time.Now().UnixNano()),
		"description": "Integration fixture", "platform": "Steam", "region": "Global", "priceCents": 1001, "quantity": 1,
	}, 201, &item)
	defer seller.expect(t, "DELETE", "/account/items/"+item.ID, nil, 204, nil)

	var price struct{ PriceCents int }
	seller.expect(t, "POST", "/account/items/"+item.ID+"/price", map[string]int{"priceCents": 1001, "discountPercent": 50}, 200, &price)
	if price.PriceCents != 501 {
		t.Fatalf("half-cent rounding: got %d, want 501", price.PriceCents)
	}
	var details struct{ Offers []struct{ ID int64 } }
	first.expect(t, "GET", "/products/"+item.ID, nil, 200, &details)
	if len(details.Offers) != 1 {
		t.Fatal("expected one seller offer")
	}
	offers := []int64{details.Offers[0].ID}
	request := func(id string, decline bool, total int) purchaseInput {
		return purchaseInput{Offers: offers, Total: int64(total), RequestID: id, Decline: decline}
	}
	first.expect(t, "POST", "/checkout", request("11111111-1111-1111-1111-111111111111", true, 501), 402, nil)
	first.expect(t, "POST", "/checkout", request("11111111-1111-1111-1111-111111111112", false, 1001), 409, nil)

	type result struct {
		api      testAPI
		input    purchaseInput
		code     int
		response []byte
		err      error
	}
	results := make(chan result, 2)
	start := make(chan struct{})
	for index, api := range []testAPI{first, second} {
		input := request(fmt.Sprintf("22222222-2222-2222-2222-%012d", index), false, 501)
		go func() {
			<-start
			code, raw, err := api.request("POST", "/checkout", input)
			results <- result{api, input, code, raw, err}
		}()
	}
	close(start)
	wins, conflicts := 0, 0
	for range 2 {
		response := <-results
		if response.err != nil {
			t.Fatal(response.err)
		}
		switch response.code {
		case 200:
			wins++
			if !bytes.Contains(response.response, []byte("DEMO-")) {
				t.Fatalf("missing demo key: %s", response.response)
			}
			code, repeated, err := response.api.request("POST", "/checkout", response.input)
			if err != nil || code != 200 || !bytes.Equal(repeated, response.response) {
				t.Fatal("retry should return the same receipt")
			}
		case 409:
			conflicts++
		default:
			t.Fatalf("unexpected checkout status %d: %s", response.code, response.response)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("one key must have one buyer; wins=%d conflicts=%d", wins, conflicts)
	}
}

func TestAuthRateLimit(t *testing.T) {
	limiter := authLimiter{attempts: make(map[string]int)}
	handler := limiter.limit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) }))
	for attempt := 0; attempt <= 60; attempt++ {
		request := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		expected := http.StatusNoContent
		if attempt == 60 {
			expected = http.StatusTooManyRequests
		}
		if response.Code != expected {
			t.Fatalf("attempt %d: got %d, want %d", attempt+1, response.Code, expected)
		}
	}
}
