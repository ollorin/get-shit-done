---
title: "[Endpoint Name]"
summary: "[One-line description of what this endpoint does]"
domain: api
tags: [endpoint-category, feature-name]
audience: [backend-developers, integrators]
prerequisites: []
related: []
updated: YYYY-MM-DD
status: draft
---

# [Endpoint Name]

> **AI Summary**: [2-3 sentences describing the endpoint's purpose, key technologies
> (e.g., response caching, rate limiting), authentication requirements, and use cases.]

> **Key Concepts**: [concept1, concept2, concept3]

> **Related Docs**:
> - [Related Doc](/docs/path/to/doc.md) - Why it's related

---

## Endpoint Overview

**Method:** `[GET|POST|PUT|PATCH|DELETE]`
**Path:** `/path/to/endpoint`
**Authentication:** `[Required|Optional|Public]`
**Rate Limit:** `[X requests per Y minutes]`

### Purpose

[Describe what this endpoint does and when to use it.]

---

## Request Specification

### Headers

| Header | Required | Description | Example |
|--------|----------|-------------|---------|
| `Authorization` | Yes/No | Session token | `Bearer <token>` |
| `Content-Type` | Yes/No | Request format | `application/json` |

### Path Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `[param]` | string | Yes/No | [Description] | `abc123` |

### Query Parameters

| Parameter | Type | Required | Description | Default | Example |
|-----------|------|----------|-------------|---------|---------|
| `[param]` | string | Yes/No | [Description] | `[default]` | `value` |

### Request Body

```json
{
  "field1": "string - [description]",
  "field2": 123
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `field1` | string | Yes | Min: 3, Max: 50 | [Description] |
| `field2` | integer | Yes | Min: 1 | [Description] |

---

## Response Specification

### Success Response (200/201)

```json
{
  "success": true,
  "data": {
    "field1": "value",
    "created_at": "2026-02-13T00:00:00Z"
  }
}
```

### Status Codes

| Status | Description | When |
|--------|-------------|------|
| `200 OK` | Success | [When] |
| `400 Bad Request` | Invalid input | [When] |
| `401 Unauthorized` | Missing/invalid auth | [When] |
| `404 Not Found` | Resource missing | [When] |
| `429 Too Many Requests` | Rate limited | [When] |

---

## Error Handling

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

### Error Codes

| Code | HTTP Status | Description | Resolution |
|------|-------------|-------------|------------|
| `VALIDATION_ERROR` | 422 | Invalid input | Check request against schema |
| `UNAUTHORIZED` | 401 | Invalid token | Re-authenticate |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests | Wait and retry |

---

## Examples

### Success Request

```bash
curl -X POST https://api.example.com/path \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"field1": "value", "field2": 42}'
```

```json
{
  "success": true,
  "data": {"id": "abc123", "field1": "value"}
}
```

### Error Request

```bash
curl -X POST https://api.example.com/path \
  -H "Content-Type: application/json" \
  -d '{"field1": "ab"}'
```

```json
{
  "success": false,
  "error": {"code": "VALIDATION_ERROR", "message": "field1 must be at least 3 characters"}
}
```

---

## Rate Limiting

| Endpoint | Limit | Window | Per |
|----------|-------|--------|-----|
| This endpoint | X | Y minutes | IP / User |

**Headers:**
- `X-RateLimit-Limit`: Maximum requests
- `X-RateLimit-Remaining`: Requests left
- `X-RateLimit-Reset`: Reset timestamp

---

## Security

- **Authentication:** [Token type, placement, lifetime]
- **Authorization:** [Required permissions]
- **Input Validation:** [Sanitization rules]

---

## Related Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/related/1` | GET | [Description] |
| `/related/2` | POST | [Description] |
