---
name: assemble_pptx_file
description: The All-in-One PPTX Factory. Validates HTML, extracts layout metrics via Playwright, and generates native editable PowerPoint files.
---

# Assemble PPTX File (The Factory)

This is the **Build Engine** of the system. It takes HTML slides and turns them into a `.pptx` file.
It integrates three critical steps:
1.  **Lint**: Checks HTML for structure violations.
2.  **Extract**: Uses a Headless Browser (Playwright) to measure the "Real Truth" of the layout.
3.  **Assemble**: Uses `PptxGenJS` to write native, editable PPT shapes and text.

## Core Capabilities

*   **Validation**: Enforces the `PPT_HTML_GUIDE` rules.
*   **WSIWYG**: "What You See Is What You Get". Measures browser pixels, converts to PPT points.
*   **Smart Mapping**:
    *   `<div>` -> **Shape** (Rectangle/Circle)
    *   `<p>` -> **Text Box**
    *   `<div class="placeholder">` -> **Chart Area**

## Usage

### 1. The Linter (Standalone)
Use this to check HTML before attempting conversion.
```bash
python3 my_skills/assemble_pptx_file/scripts/lint_ppt_html.py "input/slide.html"
```

### 2. The Converter (JS)
The core engine. Requires `node`.
```bash
node my_skills/assemble_pptx_file/scripts/html2pptx.js "input/slide.html"
```
*(Note: This usually runs part of a larger pipeline)*

### 3. The Assembler (Python Orchestrator)
Orchestrates the conversion of multiple slides into one presentation.
```bash
python3 my_skills/assemble_pptx_file/scripts/create_pptx_hybrid.py "input/metrics.json" "output.pptx"
```

## Dependencies

### Node.js
*   `pptxgenjs`: The generator library.
*   `playwright`: The measurement engine.
*   `sharp`: For rasterizing complex CSS (gradients, etc).

### Python
*   `python-pptx`: For hybrid assembly.
*   `beautifulsoup4`: For the linter.

## HTML Requirements
Refer to `architect_html_layouts/PPT_HTML_GUIDE.md` for strict layout rules.
**Violation of these rules will result in empty shapes or missing text.**
