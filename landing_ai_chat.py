def chat_with_document_via_landing_ai(document_id: str, job_id: str, query: str) -> Dict[str, Any]:
    """
    Use Landing.AI's chat feature to query a document
    """
    try:
        if not settings.VISION_AGENT_API_KEY:
            raise Exception("Landing.AI API key not found.")
        
        # Log the attempt for debugging
        print(f"Attempting to chat with Landing.AI using job_id: {job_id}")
        
        # Prepare API key and endpoint
        api_key = settings.VISION_AGENT_API_KEY
        
        # This is the correct endpoint format based on their documentation
        url = f"{settings.ADE_ENDPOINT}/chat"
        
        # Prepare headers with authorization
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        # Prepare the payload
        payload = {
            "job_id": job_id,
            "query": query
        }
        
        # Log what we're sending
        print(f"Sending payload to Landing.AI: {payload}")
        print(f"To URL: {url}")
        
        # Make the API request
        response = requests.post(url, headers=headers, json=payload)
        
        # Log the response for debugging
        print(f"Landing.AI chat response status: {response.status_code}")
        print(f"Landing.AI chat response: {response.text[:200]}...")  # Show first 200 chars
        
        # Check if request was successful
        if response.status_code != 200:
            raise Exception(f"ADE Chat API request failed: {response.text}")
        
        # Parse the response
        chat_response = response.json()
        
        # Extract the answer and sources
        answer = chat_response.get("answer", "")
        sources = chat_response.get("sources", [])
        
        return {
            "answer": answer,
            "sources": sources
        }
    
    except Exception as e:
        print(f"Error using Landing.AI chat: {str(e)}")
        # Return a fallback error response
        return {
            "answer": f"Error using Landing.AI chat: {str(e)}",
            "sources": []
        }