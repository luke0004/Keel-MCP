# Keel-MCP — How to Use (Preliminary Version)

Keel-MCP is a local research tool that lets an AI language model read, search, and annotate a corpus of historical texts — entirely on your own computer, without sending your data to any cloud service.

---

## What you need

| Requirement | Why |
|---|---|
| [Node.js 20+](https://nodejs.org) | Runs the server |
| [Ollama](https://ollama.com) | Runs the AI model locally |
| A folder of `.md` or `.txt` files | Your corpus |

---

## 1 · Start the server

Open a terminal in the `keel-mcp` folder and run:

```bash
npm install       # first time only
npm run web
```

Then open **http://localhost:3000** in your browser.

---

## 2 · Pull an AI model

In a second terminal:

```bash
ollama pull qwen2.5:7b
```

This downloads a ~5 GB model optimised for tool use and multilingual texts. It runs fully offline after the initial download.

---

## 3 · Prepare your corpus files

Each file should be a plain `.md` or `.txt` file. The tool reads metadata from three places, in order of priority:

**Option A — YAML front-matter** (most reliable):

```
---
title: Review of Beethoven's Ninth Symphony
author: E.T.A. Hoffmann
publication_date: 1810-07-04
source: Allgemeine musikalische Zeitung
tags: [romanticism, sublime, beethoven]
---

Full text of the review starts here…
```

**Option B — filename convention** (automatic fallback):

```
1810-07-04, E.T.A. Hoffmann.md
```

The date prefix `YYYY-MM-DD` is extracted automatically. The remainder becomes the title.

**Option C — fill in the form** when uploading (overridden by front-matter if present).

---

## 4 · Upload the corpus

Drag your folder of files onto the **drop zone** in the browser. All `.md` and `.txt` files in the folder are imported at once. You can also add shared tags (e.g. `music criticism, 19th century`) in the form before uploading.

---

## 5 · Run an analysis with the AI

Use the Python snippet below in a Jupyter notebook or script. It gives the model access to your corpus via the local tool API.

```python
from openai import OpenAI
import requests, json

client = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="ollama",
)

tools  = requests.get("http://localhost:3000/api/tools").json()["tools"]

messages = [
    {
        "role": "system",
        "content": (
            "You are a musicology research assistant. "
            "Use the available tools to analyse the corpus. "
            "When you find a relevant passage, write an annotation with a concise tag. "
            "The corpus is in German. Write every annotation in German. "
            "Do not translate. Do not use English. "
            "IMPORTANT: Always use document IDs returned by search_corpus or read_corpus. "
            "Never invent or guess a document ID. "
            "If search_corpus returns no results, try a shorter or simpler keyword (1-2 words maximum). "
            "Do not use full sentences or phrases as search queries."
        ),
    },
    {
        "role": "user",
        "content": "Search the corpus for uses of the word 'sublime' and annotate the three most significant passages.",
    },
]

# Agentic loop — the model calls tools until it is done
for _ in range(10):
    response = client.chat.completions.create(
        model="qwen2.5:7b",
        tools=tools,
        messages=messages,
    )
    msg = response.choices[0].message
    messages.append(msg)

    if not msg.tool_calls:
        print(msg.content)
        break

    for call in msg.tool_calls:
        result = requests.post("http://localhost:3000/api/tools/call", json={
            "name": call.function.name,
            "arguments": call.function.arguments,
        }).json()
        messages.append({
            "role": "tool",
            "tool_call_id": call.id,
            "content": result["result"],
        })
```

You can replace `"qwen2.5:7b"` with any Ollama model that supports tool calling, or point `base_url` at the Claude or Gemini API instead.

---

## 6 · Review annotations in the browser

Open the **Corpus Library** section at the bottom of the page. Click any document title to expand its annotations:

- **Purple** entries are written by the AI — immutable, preserved as a record.
- **Green** entries are yours — add corrections, interpretations, or context using the form below each document.

Your annotations and the AI's annotations are stored separately and never overwrite each other.

---

## 7 · Search the corpus yourself

Use the **Search Corpus** box. The search engine supports:

| Query | Finds |
|---|---|
| `sublime` | any document containing the word |
| `"nature metaphor"` | the exact phrase |
| `Kant AND beauty` | both words in the same document |
| `philos*` | prefix wildcard (philosophy, philosophical, …) |

---

## Useful actions

| Action | How |
|---|---|
| Delete a single document | Click **Delete** next to it in the library |
| Delete everything and start fresh | Click **Delete All** in the top-right corner |
| Watch what the AI is doing | The **Live Agent Activity** panel updates in real time |

---

## A note on privacy

All data stays on your machine. No text, annotation, or search query is sent to an external server unless you explicitly configure a cloud model (Claude, Gemini) instead of Ollama.
