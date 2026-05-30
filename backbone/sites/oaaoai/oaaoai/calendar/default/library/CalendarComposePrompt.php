<?php

declare(strict_types=1);

namespace oaaoai\calendar;

/** Compose (llm_stream) fence contract — owned by oaaoai/calendar. */
final class CalendarComposePrompt
{
    public static function body(): string
    {
        return <<<'TXT'
Calendar Schedule
===
When the user asked to schedule time, add a fence block immediately after the calendar section is complete. Keep the reply fluent.

Schema:
```oaao-calendar
{"title":"string","start_at":"ISO-8601Z","end_at":"ISO-8601Z","all_day":false,"timezone":"UTC","location":"string","notes":"string","confidence":0.85,"fence_memo":"string","fence_items":["string"]}
```

Upcoming calendar (avoid conflicts; do not schedule in the past):
{{upcoming_calendar_events}}
TXT;
    }
}
