# IBM Bob Usage Statement

**[OUTLINE — to be completed by the team. Maximum 500 words in the final submission.]**

---

## How we used IBM Bob

*(Be specific. List the Bob features you used, with concrete examples.)*

### Bob skill: `review-brief`

We created a Bob skill at `.bob/skills/review-brief/SKILL.md` that guides Bob through a
structured PR analysis workflow:

1. Bob identifies base and head commit SHAs from git metadata.
2. Bob reads the diff and relevant file sections using `read_file` and `grep`.
3. Bob inspects unchanged callers to identify breakage risk.
4. Bob reads project context from `docs/sample-context/`.
5. Bob produces a `ReviewBrief` JSON document matching our TypeScript/Zod schema.
6. Bob validates the JSON before handing it back.

### Bob as a development assistant

*(Add specific examples of how Bob helped write code, types, tests, or documentation during
initialization. Reference actual bob_sessions/ screenshots once they exist.)*

---

## What Bob did not do

- Bob did not automatically approve or merge any PR.
- Bob did not access GitHub's API or authenticate to any external service.
- Bob did not generate fake screenshots, session evidence, or benchmark results.
- Bob did not implement the breaking change (404 response) — that is preserved for the real PR.

---

## Session evidence

Screenshots from Bob IDE task sessions are saved in:

```
bob_sessions/teammate-one/
bob_sessions/teammate-two/
```

*(Reference specific screenshots here once they exist.)*

---

*Final statement must not exceed 500 words. Remove outline comments before submission.*
