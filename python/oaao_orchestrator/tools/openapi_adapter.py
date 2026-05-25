"""OpenAPI 3.x → OpenAI function tools[]."""

from __future__ import annotations

from typing import Any


def _schema_from_param(param: dict[str, Any]) -> dict[str, Any]:
    schema = param.get("schema") if isinstance(param.get("schema"), dict) else {}
    if not schema and param.get("type"):
        schema = {"type": param.get("type")}
    if not schema:
        schema = {"type": "string"}
    desc = param.get("description")
    if isinstance(desc, str) and desc.strip():
        schema = {**schema, "description": desc.strip()}
    return schema


def openapi_to_openai_tools(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Convert OpenAPI 3.x paths to OpenAI ``tools`` entries."""
    if not isinstance(spec, dict):
        return []
    paths = spec.get("paths")
    if not isinstance(paths, dict):
        return []
    out: list[dict[str, Any]] = []
    for path, methods in paths.items():
        if not isinstance(methods, dict):
            continue
        for method, op in methods.items():
            if method.lower() not in ("get", "post", "put", "patch", "delete"):
                continue
            if not isinstance(op, dict):
                continue
            op_id = str(op.get("operationId") or f"{method}_{path.strip('/').replace('/', '_')}").strip()
            if not op_id:
                continue
            props: dict[str, Any] = {}
            required: list[str] = []
            for param in op.get("parameters") or []:
                if not isinstance(param, dict):
                    continue
                name = str(param.get("name") or "").strip()
                if not name:
                    continue
                props[name] = _schema_from_param(param)
                if param.get("required"):
                    required.append(name)
            body = op.get("requestBody")
            if isinstance(body, dict):
                content = body.get("content")
                if isinstance(content, dict):
                    app_json = content.get("application/json")
                    if isinstance(app_json, dict):
                        schema = app_json.get("schema")
                        if isinstance(schema, dict) and schema.get("properties"):
                            for pname, pschema in schema["properties"].items():
                                if isinstance(pschema, dict):
                                    props[str(pname)] = pschema
                            req_body = schema.get("required")
                            if isinstance(req_body, list):
                                required.extend(str(x) for x in req_body)
            parameters: dict[str, Any] = {"type": "object", "properties": props}
            if required:
                parameters["required"] = sorted(set(required))
            description = str(op.get("summary") or op.get("description") or op_id).strip()
            out.append(
                {
                    "type": "function",
                    "function": {
                        "name": op_id[:64],
                        "description": description[:512],
                        "parameters": parameters,
                    },
                }
            )
    return out
