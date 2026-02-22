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
            "When you find a relevant passage, write an annotation with a concise tag."
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