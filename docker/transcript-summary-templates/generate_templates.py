#!/usr/bin/env python3
"""Generate transcript summary template .md files for Docker bind mount."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent

TEMPLATES: list[dict] = [
    {"id": "general-meeting", "label": "General Meeting", "emoji": "📋", "default": True, "sort": 1,
     "prompt": "Summarize as a **general meeting** note.\n\nInclude: overview, key discussion points, decisions, action items (with owner if speakers are labeled), open questions.\nUse the transcript language. Do not invent facts."},
    {"id": "psychotherapy-note", "label": "Psychotherapy Note", "emoji": "🧾", "beta": True, "sort": 2,
     "prompt": "Summarize as a **psychotherapy session note** (clinical tone, no diagnosis unless explicitly stated in transcript).\n\nInclude: presenting themes, interventions discussed, client insights, homework or follow-up, risk/safety notes only if mentioned.\nMaintain confidentiality tone; use neutral language."},
    {"id": "weekly-team-meeting", "label": "Weekly Team Meeting", "emoji": "📈", "sort": 3,
     "prompt": "Summarize as a **weekly team meeting**.\n\nInclude: week-in-review highlights, blockers, priorities for next week, owners for action items, dependencies."},
    {"id": "one-on-one-meeting", "label": "1 on 1 Meeting", "emoji": "👥", "sort": 4,
     "prompt": "Summarize as a **1:1 meeting** between manager and report (or peers).\n\nInclude: wins, feedback exchanged, career/goal topics, commitments, next check-in items."},
    {"id": "business-call", "label": "Business Call", "emoji": "☎️", "sort": 5,
     "prompt": "Summarize as a **business phone/video call**.\n\nInclude: purpose, parties involved, commercial or operational points, agreements, next steps, deadlines."},
    {"id": "client-meeting", "label": "Client Meeting", "emoji": "🤝", "sort": 6,
     "prompt": "Summarize as a **client meeting**.\n\nInclude: client goals, requirements discussed, scope changes, risks, deliverables, follow-up actions."},
    {"id": "project-kickoff-meeting", "label": "Project Kickoff Meeting", "emoji": "🏁", "sort": 7,
     "prompt": "Summarize as a **project kickoff**.\n\nInclude: objectives, scope, timeline milestones, roles/RACI if mentioned, success criteria, immediate next steps."},
    {"id": "retrospective-meeting", "label": "Retrospective Meeting", "emoji": "🔙", "sort": 8,
     "prompt": "Summarize as an agile **retrospective**.\n\nStructure: What went well, What didn't, Action items for improvement, Experiments to try."},
    {"id": "stakeholder-meeting", "label": "Stakeholder Meeting", "emoji": "🤝", "sort": 9,
     "prompt": "Summarize as a **stakeholder meeting**.\n\nInclude: stakeholder concerns, status updates, decisions needed, risks, communication plan items."},
    {"id": "brainstorming", "label": "Brainstorming", "emoji": "🧠", "sort": 10,
     "prompt": "Summarize a **brainstorming session**.\n\nGroup ideas by theme, highlight top-voted or agreed directions, capture wildcards, list next validation steps."},
    {"id": "status-update-meeting", "label": "Status Update Meeting", "emoji": "📈", "sort": 11,
     "prompt": "Summarize as a **status update** meeting.\n\nUse RAG-style bullets: Red/Amber/Green themes if applicable, progress vs plan, blockers, ETA changes."},
    {"id": "sales-pitches", "label": "Sales Pitches", "emoji": "💵", "beta": True, "sort": 12,
     "prompt": "Summarize as a **sales pitch / discovery call**.\n\nInclude: prospect pain points, proposed solution fit, objections, pricing/timeline signals, next steps in pipeline."},
    {"id": "regular-project-meeting", "label": "Regular Project Meeting", "emoji": "📆", "sort": 13,
     "prompt": "Summarize as a **recurring project sync**.\n\nInclude: milestone status, task updates, risks/issues log, decisions, action items with owners."},
    {"id": "job-interview", "label": "Job Interview", "emoji": "👥", "sort": 14,
     "prompt": "Summarize as a **job interview** (candidate perspective neutral).\n\nInclude: role discussed, candidate strengths/evidence, gaps, compensation/logistics if mentioned, interviewer follow-ups."},
    {"id": "board-meeting", "label": "Board Meeting", "emoji": "💼", "beta": True, "sort": 15,
     "prompt": "Summarize as a **board meeting** (executive brief).\n\nInclude: financial/ KPI highlights, strategic decisions, governance items, approved actions, confidential items only if explicitly in transcript."},
    {"id": "online-course", "label": "Online Course", "emoji": "🎓", "sort": 16,
     "prompt": "Summarize as **online course** content.\n\nInclude: module topic, learning objectives, key concepts, examples, assignments mentioned, study tips."},
    {"id": "class-recording", "label": "Class Recording", "emoji": "📚", "sort": 17,
     "prompt": "Summarize a **recorded class session**.\n\nInclude: topic, lecture outline, definitions, worked examples, homework, exam hints."},
    {"id": "business-training", "label": "Business Training", "emoji": "👔", "sort": 18,
     "prompt": "Summarize **business training** material.\n\nInclude: frameworks taught, exercises, takeaways for workplace application, resources cited."},
    {"id": "memo", "label": "Memo", "emoji": "🗒️", "sort": 19,
     "prompt": "Rewrite as a concise **internal memo**.\n\nFormat: Subject, Background, Key points, Recommendation/Decision, Action required."},
    {"id": "shopping-list", "label": "Shopping List", "emoji": "🛒", "sort": 20,
     "prompt": "Extract a **shopping list** from the transcript.\n\nGroup by store aisle or category if possible; include quantities and brands mentioned."},
    {"id": "youtube", "label": "YouTube", "emoji": "📺", "sort": 21,
     "prompt": "Summarize as **YouTube video notes**.\n\nInclude: hook/topic, chapter-style sections with timestamps if available, key quotes, links/resources mentioned, CTA."},
    {"id": "podcast", "label": "Podcast", "emoji": "🎙️", "sort": 22,
     "prompt": "Summarize as **podcast show notes**.\n\nInclude: episode theme, guest intro, segment highlights, notable quotes, resources, listener takeaways."},
    {"id": "daily-meeting", "label": "Daily Meeting", "emoji": "📋", "sort": 23,
     "prompt": "Summarize as a **daily stand-up / daily sync**.\n\nPer participant if identifiable: yesterday, today, blockers. Team-level themes and escalations."},
    {"id": "life-call", "label": "Life Call", "emoji": "☎️", "sort": 24,
     "prompt": "Summarize a **personal life call** warmly and succinctly.\n\nCapture main topics, emotional tone, plans made, follow-ups, important dates."},
    {"id": "fun-meeting-moments", "label": "Fun Meeting Moments", "emoji": "😄", "sort": 25,
     "prompt": "Highlight **fun / memorable moments** from the meeting.\n\nInclude humorous quotes (lightly edited), team bonding bits, celebrations—keep good-natured tone."},
    {"id": "user-interview", "label": "User Interview", "emoji": "👥", "sort": 26,
     "prompt": "Summarize a **user research interview**.\n\nInclude: participant context (if shared), jobs-to-be-done, pain points, workflows, quotes, insights, product implications."},
    {"id": "project-sync", "label": "Project Sync", "emoji": "📌", "sort": 27,
     "prompt": "Summarize a **project sync**.\n\nFocus on delta since last sync: completed work, in-progress, blockers, decisions, next deliverables."},
    {"id": "class", "label": "Class", "emoji": "📚", "sort": 28,
     "prompt": "Summarize **class discussion** notes.\n\nInclude topic, instructor points, student Q&A themes, readings referenced."},
    {"id": "lecture", "label": "Lecture", "emoji": "🎓", "sort": 29,
     "prompt": "Summarize a **lecture**.\n\nStructured outline with headings, definitions, formulas/theorems if any, illustrative examples."},
    {"id": "stand-up-meeting", "label": "Stand Up Meeting", "emoji": "📊", "sort": 30,
     "prompt": "Summarize an agile **stand-up**.\n\nShort bullets per speaker: done, doing, impediments. Sprint goal alignment notes."},
    {"id": "panel-discussion", "label": "Panel Discussion", "emoji": "💬", "sort": 31,
     "prompt": "Summarize a **panel discussion**.\n\nInclude panelists' main arguments, areas of agreement/disagreement, audience questions, conclusions."},
    {"id": "journalist-interview-notes", "label": "Journalist Interview Notes", "emoji": "🎤", "sort": 32,
     "prompt": "Summarize **journalist interview** notes.\n\nInclude: lead angle, key quotes (attributed), fact checks needed, narrative threads, publishable headline ideas."},
    {"id": "soap", "label": "SOAP", "emoji": "🩺", "beta": True, "sort": 33,
     "prompt": "Summarize using **SOAP** clinical note format where evidence exists in transcript:\n\n**S**ubjective, **O**bjective (only stated facts), **A**ssessment ( cautious ), **P**lan.\nDo not fabricate clinical data."},
    {"id": "healthcare-consultation", "label": "Healthcare Consultation", "emoji": "🏥", "beta": True, "sort": 34,
     "prompt": "Summarize a **healthcare consultation** (patient-friendly summary).\n\nInclude: reason for visit, discussed symptoms/treatments, instructions given, follow-up appointments, questions to ask provider."},
    {"id": "all-hands-meeting", "label": "All Hands Meeting", "emoji": "📝", "sort": 35,
     "prompt": "Summarize a company **all-hands**.\n\nInclude: leadership messages, metrics, org updates, Q&A highlights, cultural announcements, employee resources."},
    {"id": "sprint-planning", "label": "Sprint Planning", "emoji": "💻", "sort": 36,
     "prompt": "Summarize **sprint planning**.\n\nInclude: sprint goal, committed stories/tasks, capacity notes, dependencies, definition of done reminders."},
    {"id": "pipeline-review", "label": "Pipeline Review", "emoji": "🔄", "beta": True, "sort": 37,
     "prompt": "Summarize a **sales/ops pipeline review**.\n\nInclude: stage movements, forecast changes, deal risks, wins/losses, actions to unblock deals."},
    {"id": "customer-onboarding", "label": "Customer Onboarding", "emoji": "🤝", "sort": 38,
     "prompt": "Summarize **customer onboarding** call.\n\nInclude: account setup steps, training covered, integrations, success criteria, timeline, support contacts."},
    {"id": "supplier-visit-meeting", "label": "Supplier Visit Meeting", "emoji": "🚚", "sort": 39,
     "prompt": "Summarize a **supplier visit** meeting.\n\nInclude: quality/logistics topics, SLA discussion, pricing/terms signals, audit findings, corrective actions."},
]


def yaml_line(key: str, value: str | bool | int) -> str:
    if isinstance(value, bool):
        return f"{key}: {'true' if value else 'false'}"
    if isinstance(value, int):
        return f"{key}: {value}"
    escaped = str(value).replace('"', '\\"')
    return f'{key}: "{escaped}"'


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    for t in TEMPLATES:
        lines = [
            "---",
            yaml_line("id", t["id"]),
            yaml_line("label", t["label"]),
            yaml_line("emoji", t["emoji"]),
            yaml_line("beta", t.get("beta", False)),
            yaml_line("default", t.get("default", False)),
            yaml_line("sort", t["sort"]),
            "---",
            "",
            t["prompt"],
            "",
        ]
        (ROOT / f"{t['id']}.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {len(TEMPLATES)} templates to {ROOT}")


if __name__ == "__main__":
    main()
