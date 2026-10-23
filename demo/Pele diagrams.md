---
title: Pele diagrams
tags: [slides, demo]
---

# Images still work

![[slides-demo.svg]]

> [!slide] Notes
> Existing images stay unchanged. These notes stay private.
>
> ```mermaid
> flowchart LR
>   Private --> Hidden
> ```

---

# Text, image and diagram

- Write the explanation in Markdown.
- Keep the existing illustration.
- Edit the process as Mermaid text.

```mermaid
flowchart LR
  accTitle: Review process
  accDescr: A draft is reviewed before publication.
  A[Draft] --> B{Review}
  B -->|Ready| C[Publish]
  B -->|Revise| A
```

![[slides-demo.svg]]

> [!slide] Notes
> Text shares the slide with both visual resources.

---

# A flow with its own frontmatter

```mermaid
---
title: One decision at a time
---
flowchart LR
  Request[Request] --> Agent[Agent]
  Agent --> Tools[Tools]
  Tools --> Check{Check}
  Check -->|Approved| Result[Result]
  Check -->|Revise| Agent
```

---

# A sequence

```mermaid
sequenceDiagram
  actor Author
  participant Agent
  participant Reviewer
  Author->>Agent: Prepare a draft
  Agent->>Reviewer: Request review
  Reviewer-->>Agent: Changes requested
  Agent-->>Author: Revised draft
```

---

# An XY chart

```mermaid
xychart-beta
  x-axis [Mon, Tue, Wed, Thu, Fri]
  y-axis "Completed requests" 0 --> 100
  bar [20, 35, 50, 65, 80]
  line [25, 40, 55, 70, 90]
```

---

# Two independent diagrams

```mermaid
flowchart TB
  A[Question] --> B[Evidence] --> C[Answer]
```

```mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Reviewed
  Reviewed --> Published
```

---

# A comprehensible error

```mermaid
flowchart LR
  A -->
```

---

# A literal example

The following is Markdown source, not a live diagram:

````markdown
```mermaid
flowchart LR
  Draft --> Ready
```
````
