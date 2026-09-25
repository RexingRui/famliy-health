// Package errs carries business errors from service up to the HTTP layer, which maps
// them to the unified error body. Message is shown to users; Err only goes to logs.
package errs

import (
	"errors"
	"fmt"
	"net/http"
)

type Error struct {
	Status  int
	Code    string
	Message string
	Fields  map[string]string
	Err     error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %s: %v", e.Code, e.Message, e.Err)
	}
	return e.Code + ": " + e.Message
}

func (e *Error) Unwrap() error { return e.Err }

func As(err error) (*Error, bool) {
	var e *Error
	ok := errors.As(err, &e)
	return e, ok
}

func BadRequest(msg string) *Error {
	return &Error{Status: http.StatusBadRequest, Code: "bad_request", Message: msg}
}

func Unauthorized(msg string) *Error {
	return &Error{Status: http.StatusUnauthorized, Code: "unauthorized", Message: msg}
}

func Forbidden(msg string) *Error {
	return &Error{Status: http.StatusForbidden, Code: "forbidden", Message: msg}
}

func NotFound(msg string) *Error {
	return &Error{Status: http.StatusNotFound, Code: "not_found", Message: msg}
}

func Conflict(msg string) *Error {
	return &Error{Status: http.StatusConflict, Code: "conflict", Message: msg}
}

func TooLarge(msg string) *Error {
	return &Error{Status: http.StatusRequestEntityTooLarge, Code: "too_large", Message: msg}
}

func TooManyRequests(msg string) *Error {
	return &Error{Status: http.StatusTooManyRequests, Code: "too_many_requests", Message: msg}
}

func Unavailable(msg string, err error) *Error {
	return &Error{Status: http.StatusServiceUnavailable, Code: "unavailable", Message: msg, Err: err}
}

// Validation reports field-level problems (HTTP 422). Keys are API field names.
func Validation(msg string, fields map[string]string) *Error {
	return &Error{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: msg, Fields: fields}
}

// Fields accumulates field errors; the first message becomes the error message.
type Fields struct {
	first  string
	fields map[string]string
}

func (f *Fields) Add(field, code, msg string) {
	if f.fields == nil {
		f.fields = map[string]string{}
		f.first = msg
	}
	if _, ok := f.fields[field]; !ok {
		f.fields[field] = code
	}
}

func (f *Fields) Err() error {
	if f.fields == nil {
		return nil
	}
	return Validation(f.first, f.fields)
}
