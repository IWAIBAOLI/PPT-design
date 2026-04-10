async function testCreate() {
    const payload = {
        id: null,
        project_name: "Test Draft AutoSave",
        user_prompt: "Test Prompt",
        brief_json: {},
        content_draft: { title: "Draft Content" },
        model_used: "gemini"
    };

    console.log("Sending payload:", JSON.stringify(payload, null, 2));

    try {
        const response = await fetch('http://localhost:3000/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log("Response:", data);
    } catch (e) {
        console.error("Fetch error:", e);
    }
}

testCreate();
