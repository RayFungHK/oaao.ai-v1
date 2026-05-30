<?php

declare(strict_types=1);

namespace oaaoai\todo;

/** Compose (llm_stream) fence contract — owned by oaaoai/todo. */
final class TodoComposePrompt
{
    public static function body(): string
    {
        return <<<'TXT'
Todo
===
When the user tracks todos — create, remove, or resolve — add a fence block immediately after the todo section is complete. Keep the reply fluent.

Schema:
```oaao-todo
{"type":"todo_items_suggested","fence_memo":"string","fence_items":["string"],"items":[{"title":"string","context_snippet":"string","confidence":0.85,"priority":"normal","due_at":null}]}
```

Open todos for this conversation (avoid duplicate titles):
{{open_todo_items}}
TXT;
    }
}
