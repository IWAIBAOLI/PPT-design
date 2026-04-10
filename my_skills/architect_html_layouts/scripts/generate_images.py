import os
import sys
import json
import logging
import argparse
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def load_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    logger.info(f"Saved JSON: {path}")

def call_llm_for_prompt(description, style_context, api_key, base_url, model_name):
    """Refine the user description into a instruction set for image generation/search."""
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url)
        
        # Load System Prompt
        base_dir = Path(__file__).parent.parent
        lang = os.environ.get("LANGUAGE", "cn").lower()
        filename = "illustrator_system.cn.md" if lang == "cn" else "illustrator_system.md"
        
        system_prompt_path = base_dir / "resources" / filename
        if not system_prompt_path.exists():
             system_prompt_path = base_dir / "prompts" / filename # Fallback
        
        system_instruction = load_file(system_prompt_path)
        
        user_message = f"""
        **Brief Style Context**:
        {json.dumps(style_context, ensure_ascii=False)}
        
        **Subject Description**:
        "{description}"
        
        Generate the JSON payload now.
        """
        
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": user_message}
            ],
            response_format={"type": "json_object"},
            temperature=0.7
        )
        content = response.choices[0].message.content.strip()
        return json.loads(content)
    except Exception as e:
        logger.error(f"Error calling LLM: {e}")
        # Robust fallback
        return {
            "dalle_prompt": description,
            "pixabay_search_terms": [description[:50]],
            "color_filter": ""
        }

def search_pixabay(search_terms, color_filter, image_type, output_path, api_key):
    """Try to find an image on Pixabay using multiple search terms."""
    if not api_key:
        logger.warning("PIXABAY_API_KEY not set, skipping search.")
        return False

    import requests
    import random

    # Pixabay API supported parameters
    VALID_COLORS = ["grayscale", "transparent", "red", "orange", "yellow", "green", "turquoise", "blue", "lilac", "pink", "white", "gray", "black", "brown"]
    VALID_TYPES = ["all", "photo", "illustration", "vector"]
    
    color = color_filter.lower() if color_filter.lower() in VALID_COLORS else None
    img_type = image_type.lower() if image_type.lower() in VALID_TYPES else "photo"

    for term in search_terms:
        try:
            url = "https://pixabay.com/api/"
            params = {
                "key": api_key,
                "q": term,
                "image_type": img_type,
                "per_page": 5,
                "safesearch": "true"
            }
            if color:
                params["colors"] = color
            
            logger.info(f"Searching Pixabay for: '{term}' (type: {img_type}, color: {color or 'any'})")
            resp = requests.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

            if data.get("hits"):
                # Pick one (preferably a high quality/popular one, or just the first)
                hit = data["hits"][0]
                image_url = hit.get("largeImageURL") or hit.get("webformatURL")
                
                if image_url:
                    logger.info(f"Found Pixabay image: {image_url}")
                    img_data = requests.get(image_url).content
                    with open(output_path, 'wb') as f:
                        f.write(img_data)
                    return True
        except Exception as e:
            logger.warning(f"Pixabay search warning for '{term}': {e}")
            continue
            
    logger.info("Pixabay search exhausted all terms with no results.")
    return False

def generate_image_dalle(prompt, output_path, api_key, base_url, aspect_ratio="square"):
    """Call DALL-E to generate image."""
    logger.info(f"Generating Image via DALL-E ({aspect_ratio}) for: {prompt[:50]}...")
    
    # Map Aspect Ratio to DALL-E 3 Resolution
    size_map = {
        "square": "1024x1024",
        "wide": "1792x1024", # 16:9
        "tall": "1024x1792"  # 9:16
    }
    size = size_map.get(aspect_ratio, "1024x1024")
    
    # Check for Mock Mode
    if os.environ.get("MOCK_MODE") == "true":
        logger.info("[MOCK] Generated image (placeholder).")
        # Copy a placeholder or create a dummy file
        with open(output_path, 'wb') as f:
            f.write(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82') # 1x1 Pixel
        return True

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url)
        
        response = client.images.generate(
            model="dall-e-3",
            prompt=prompt,
            size=size,
            quality="standard",
            n=1,
        )
        
        image_url = response.data[0].url
        
        # Download Image
        import requests
        img_data = requests.get(image_url).content
        with open(output_path, 'wb') as f:
             f.write(img_data)
        
        logger.info(f"Saved Image: {output_path}")
        return True
        
    except Exception as e:
        logger.error(f"DALL-E Generation Failed: {e}")
        logger.warning("Generating Fallback Placeholder Image due to API failure.")
        
        # Fallback: Create a simple grey/colored placeholder
        try:
             with open(output_path, 'wb') as f:
                f.write(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc`\x00\x00\x00\x02\x00\x01\xe2!\xbc3\x00\x00\x00\x00IEND\xaeB`\x82')
             return True
        except Exception as write_err:
             logger.error(f"Failed to write fallback image: {write_err}")
             return False

def create_one_image(description, style_context, output_path, api_key, base_url, model_name="gpt-4o", aspect_ratio="square"):
    """
    Orchestrated function: Refine -> Try Pixabay -> Fallback DALL-E.
    Returns (Success, Info).
    """
    if output_path.exists() and os.environ.get("FORCE_REGEN") != "true":
        logger.info(f"Skipping existing image: {output_path}")
        return True, "EXISTING"

    # Step 1: Get search/generation instructions from LLM
    generation_info = call_llm_for_prompt(description, style_context, api_key, base_url, model_name)
    
    dalle_prompt = generation_info.get("dalle_prompt", description)
    search_terms = generation_info.get("pixabay_search_terms", [description])
    color_filter = generation_info.get("color_filter", "")
    image_type = generation_info.get("image_type", "photo")

    # Step 2: Try Pixabay Retrieval (Primary)
    pixabay_key = os.environ.get("PIXABAY_API_KEY")
    if pixabay_key:
        success = search_pixabay(search_terms, color_filter, image_type, output_path, pixabay_key)
        if success:
            logger.info("Successfully retrieved image from Pixabay.")
            return True, "PIXABAY"

    # Step 3: Fallback to DALL-E (Secondary)
    logger.info("Pixabay search failed or skipped. Falling back to DALL-E...")
    success = generate_image_dalle(dalle_prompt, output_path, api_key, base_url, aspect_ratio=aspect_ratio)
    return success, dalle_prompt

def generate_images(brief_path, content_path, output_dir):
    """
    Legacy loop: Scans Draft automatically. 
    Kept for backward compatibility or standalone usage.
    """
    # ... (Rest of logic remains, but can use create_one_image internally if we wanted refactoring, 
    # but for now let's just keep the Class/Function logic clean)
    
    # 1. Setup
    api_key = os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("OPENAI_BASE_URL")
    model_name = os.environ.get("OPENAI_MODEL", "gpt-4o")
    
    brief_data = json.loads(load_file(brief_path))
    draft_data = json.loads(load_file(content_path))
    
    style_context = brief_data.get("style_definition", {}).get("artistic_style", "Modern Professional")
    
    images_dir = Path(output_dir) / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    
    image_map = {} 
    
    # 2. Scan Slides
    for slide in draft_data.get("slides", []):
        slide_id = slide.get("id")
        content_items = slide.get("content_items", [])
        
        for idx, item in enumerate(content_items):
             if item.get("item_type") == "visual" or item.get("image_description"):
                description = item.get("image_description") or item.get("body") or "Abstract visualization"
                logger.info(f"Processing Slide {slide_id} Item {idx}: {description[:30]}")
                
                filename = f"{slide_id}_visual_{idx}.png"
                full_path = images_dir / filename
                
                success, final_prompt = create_one_image(description, style_context, full_path, api_key, base_url, model_name)
                
                if success:
                     if slide_id not in image_map: image_map[slide_id] = []
                     image_map[slide_id].append({
                         "item_index": idx,
                         "local_path": str(full_path),
                         "prompt": final_prompt
                     })

    # 3. Save Map
    save_json(Path(output_dir) / "image_map.json", image_map)
    logger.info("Image Generation Complete.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--brief", required=True)
    parser.add_argument("--content", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--mock", action="store_true")
    args = parser.parse_args()
    
    if args.mock:
        os.environ["MOCK_MODE"] = "true"
        
    generate_images(args.brief, args.content, args.output)
