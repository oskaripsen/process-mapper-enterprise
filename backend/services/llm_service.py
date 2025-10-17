"""
LLM Service for Intent Extraction

Uses OpenAI function calling to generate Intent JSON only.
Focuses purely on semantic extraction, not process topology.
"""

import openai
import os
import json
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

from schemas.intent_schema import ProcessIntent, get_intent_json_schema
from schemas.process_flow import FlowPatch
from services.intent_translator import IntentTranslator


class LLMService:
    """
    Service for extracting semantic intent from transcripts.
    Generates Intent JSON only - no graph topology concerns.
    """

    def __init__(self):
        load_dotenv()
        self.client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.intent_translator = IntentTranslator()

    async def extract_process_intent(
        self, transcript: str, context: Optional[str] = None, existing_flow = None
    ) -> Optional[ProcessIntent]:
        """
        Extract semantic process intent from transcript.
        Returns ProcessIntent JSON with no graph topology concerns.
        """

        system_prompt = """You are a business process analyst. Your job is to identify business process steps, decisions, and logical flows from conversations.

IMPORTANT: You only extract SEMANTIC MEANING. Do NOT worry about graph topology, node types, or technical constraints.

Your job:
1. Identify what business steps/actions happen
2. Identify decision points (where choices are made)
3. Identify the logical sequence/flow between steps
4. Identify who does what and with what tools

IGNORE:
- Meeting phrases ("thank you", "please subscribe", "live session", etc.)
- Presentation logistics 
- Technical graph concerns

FOCUS ON:
- Actual business process steps
- Decision points and their possible outcomes
- Who performs each step
- What tools/systems are used
- Logical flow/sequence

STEP TYPES:
- "step": A business action or task that is performed (DEFAULT - use this for most steps)
- "decision": A choice point with multiple possible outcomes (ONLY use when there are genuinely different paths)
- "merge": A point where multiple paths converge back together (use when parallel paths need to rejoin)
- "start_point": Explicit beginning of the process (rare - only if explicitly mentioned)
- "end_point": Explicit end of the process (rare - only if explicitly mentioned)

CRITICAL RULES FOR DECISIONS:
- Only use "decision" step_type if there are GENUINELY multiple different outcomes
- ALWAYS include the "options" field with 2+ specific outcomes
- For each decision, create separate flows for EACH option
- Example: "Check ticket type" with options ["billing", "technical"] needs TWO flows: one for billing, one for technical

MOST STEPS SHOULD BE "step" TYPE - only use decision/start_point/end_point when explicitly needed."""

        # Build context including existing node names
        context_parts = []
        if context:
            context_parts.append(f"Previous conversation: {context}")
        
        # Add existing node names to context
        if existing_flow and hasattr(existing_flow, 'nodes') and existing_flow.nodes:
            existing_node_names = [node.label for node in existing_flow.nodes if hasattr(node, 'label')]
            if existing_node_names:
                context_parts.append(f"\nEXISTING PROCESS STEPS (use these EXACT names when referring to them):\n- " + "\n- ".join(existing_node_names))
        
        context_text = "\n".join(context_parts) if context_parts else ""
        
        # Add instruction about preserving existing node names
        if existing_flow and hasattr(existing_flow, 'nodes') and existing_flow.nodes:
            context_text += "\n\nCRITICAL: When the user refers to an EXISTING step, you MUST use the EXACT step name from the list above. Do NOT rephrase, elaborate, or modify existing step names. Only add details to NEW steps."
        
        user_prompt = f"""
Transcript:
"{transcript}"

{context_text}

Extract the business process described in this transcript. Focus on:

1. STEPS: What actions/tasks are performed?
2. DECISIONS: What choices are made? What are the possible outcomes?
3. FLOWS: What is the logical sequence? What happens after what?
4. METADATA: Who does each step? What tools are used? Manual or automated?

CRITICAL RULES:
- Create ONE CONNECTED process, not multiple separate fragments
- Every step should connect to the next step in sequence
- Use simple step IDs like "s1", "s2", "s3", etc.
- IGNORE meeting phrases, pleasantries, and non-process content
- If adding to existing process, include ALL steps (existing + new) to maintain proper connections
- If transcript has no clear business process, return minimal/empty result

IGNORE COMPLETELY:
- "Thank you", "live session", "workshop", "big stage for me"
- Meeting logistics, presentations, acknowledgments
- Random chatter not related to business processes

GOOD EXAMPLE - Connected sequence:
- Step s1: Customer submits order
- Step s2: Check payment  
- Step s3: Process order
- Flow: s1 → s2 → s3

GOOD EXAMPLE - With decision:
- Step s1: Submit claim
- Step s2: Manager reviews (decision node with "options": ["approved", "rejected"])
- Step s3: Process payment
- Step s4: Send rejection
- Flows: s1→s2, s2→s3 (if approved), s2→s4 (if rejected)
Note: Use conditions on flows, don't create separate "if approved" steps!

GOOD EXAMPLE - With merge:
- Step s1: Check inventory (decision)
- Step s2: Order from supplier A
- Step s3: Order from supplier B
- Step s4: Receive order (merge node - where both paths rejoin)
- Step s5: Update inventory
- Flows: s1→s2 (if A), s1→s3 (if B), s2→s4, s3→s4, s4→s5
Use "merge" step_type when parallel paths need to rejoin!

BAD EXAMPLE - Duplicate outcome nodes:
- Step s1: Manager decides
- Step s2: "If approved, send payment" ❌ Don't do this!
- Step s3: "If rejected, send back" ❌ Don't do this!
Instead: Use ONE decision node with condition on the flows!

BAD EXAMPLE - Disconnected fragments:
- Random steps with no connections between them

Remember: ONE CONNECTED SEQUENCE, not fragments!
"""

        try:
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                functions=[
                    {
                        "name": "extract_process_intent",
                        "description": "Extract semantic process intent from transcript",
                        "parameters": get_intent_json_schema()
                    }
                ],
                function_call={"name": "extract_process_intent"},
                temperature=0.1,
            )

            function_call = response.choices[0].message.function_call
            if function_call and function_call.name == "extract_process_intent":
                result = json.loads(function_call.arguments)
                return ProcessIntent(**result)

            return None

        except Exception as e:
            print(f"LLM intent extraction error: {str(e)}")
            return None

    async def extract_process_intent_multimodal(
        self, text: str, images: List[str], context: Optional[str] = None, existing_flow = None
    ) -> Optional[ProcessIntent]:
        """
        Extract semantic process intent from text and images using GPT-4o vision.
        
        Args:
            text: Text description
            images: List of base64-encoded images (data:image/jpeg;base64,...)
            context: Optional context
            
        Returns:
            ProcessIntent JSON with no graph topology concerns.
        """

        system_prompt = """You are a business process analyst. Your job is to identify business process steps, decisions, and logical flows from text and images.

IMPORTANT: You only extract SEMANTIC MEANING. Do NOT worry about graph topology, node types, or technical constraints.

Your job:
1. Identify what business steps/actions happen
2. Identify decision points (where choices are made)
3. Identify the logical sequence/flow between steps
4. Identify who does what and with what tools

ANALYZE BOTH:
- Text descriptions provided
- Process diagrams, flowcharts, or screenshots in images
- Look for process flows, decision points, actors, and systems in visual elements

IGNORE:
- Meeting phrases ("thank you", "please subscribe", "live session", etc.)
- Presentation logistics 
- Technical graph concerns

FOCUS ON:
- Actual business process steps
- Decision points and their possible outcomes
- Who performs each step
- What tools/systems are used
- Logical flow/sequence

STEP TYPES:
- "step": A business action or task that is performed (DEFAULT - use this for most steps)
- "decision": A choice point with multiple possible outcomes (ONLY use when there are genuinely different paths)
- "merge": A point where multiple paths converge back together (use when parallel paths need to rejoin)
- "start_point": Explicit beginning of the process (rare - only if explicitly mentioned)
- "end_point": Explicit end of the process (rare - only if explicitly mentioned)

CRITICAL RULES FOR DECISIONS:
- Only use "decision" step_type if there are GENUINELY multiple different outcomes
- ALWAYS include the "options" field with 2+ specific outcomes
- For each decision, create separate flows for EACH option
- Example: "Check ticket type" with options ["billing", "technical"] needs TWO flows: one for billing, one for technical

MOST STEPS SHOULD BE "step" TYPE - only use decision/start_point/end_point when explicitly needed."""

        # Build context including existing node names
        context_parts = []
        if context:
            context_parts.append(f"Previous conversation: {context}")
        
        # Add existing node names to context
        if existing_flow and hasattr(existing_flow, 'nodes') and existing_flow.nodes:
            existing_node_names = [node.label for node in existing_flow.nodes if hasattr(node, 'label')]
            if existing_node_names:
                context_parts.append(f"\nEXISTING PROCESS STEPS (use these EXACT names when referring to them):\n- " + "\n- ".join(existing_node_names))
        
        context_text = "\n".join(context_parts) if context_parts else ""
        
        # Add instruction about preserving existing node names
        if existing_flow and hasattr(existing_flow, 'nodes') and existing_flow.nodes:
            context_text += "\n\nCRITICAL: When the user refers to an EXISTING step, you MUST use the EXACT step name from the list above. Do NOT rephrase, elaborate, or modify existing step names. Only add details to NEW steps."
        
        user_prompt = f"""
Text content:
"{text}"

{context_text}

Extract the business process described in this text and images. Focus on:

1. STEPS: What actions/tasks are performed?
2. DECISIONS: What choices are made? What are the possible outcomes?
3. FLOWS: What is the logical sequence? What happens after what?
4. METADATA: Who does each step? What tools are used? Manual or automated?

CRITICAL RULES:
- Create ONE CONNECTED process, not multiple separate fragments
- Every step should connect to the next step in sequence
- Use simple step IDs like "s1", "s2", "s3", etc.
- IGNORE meeting phrases, pleasantries, and non-process content
- If there are process diagrams in the images, extract the flow from them
- Combine information from both text and images

Remember: ONE CONNECTED SEQUENCE, not fragments!
"""

        try:
            # Build messages with text and images
            messages = [
                {"role": "system", "content": system_prompt}
            ]
            
            # Create user message with multimodal content
            user_content = [{"type": "text", "text": user_prompt}]
            
            # Add images if provided
            for image_data in images:
                user_content.append({
                    "type": "image_url",
                    "image_url": {"url": image_data}
                })
            
            messages.append({"role": "user", "content": user_content})
            
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                functions=[
                    {
                        "name": "extract_process_intent",
                        "description": "Extract semantic process intent from text and images",
                        "parameters": get_intent_json_schema()
                    }
                ],
                function_call={"name": "extract_process_intent"},
                temperature=0.1,
            )

            function_call = response.choices[0].message.function_call
            if function_call and function_call.name == "extract_process_intent":
                result = json.loads(function_call.arguments)
                return ProcessIntent(**result)

            return None

        except Exception as e:
            print(f"LLM multimodal intent extraction error: {str(e)}")
            return None

    async def clarify_process_intent(
        self, transcript: str, context: Optional[str] = None, existing_flow = None
    ):
        """
        Clarify and summarize what the user described before generating flow
        
        Returns:
            dict with steps, structure, and questions for user confirmation
        """
        try:
            # Build context for clarification
            context_parts = []
            if context:
                context_parts.append(f"Previous conversation: {context}")
            
            if existing_flow and hasattr(existing_flow, 'nodes'):
                existing_steps = [node.label for node in existing_flow.nodes if hasattr(node, 'label')]
                if existing_steps:
                    context_parts.append(f"Existing process steps: {', '.join(existing_steps)}")
            
            context_str = "\n".join(context_parts) if context_parts else "No previous context."
            
            clarification_prompt = f"""
You are a process analysis expert. A user is describing changes to a process flow. Your job is to clarify what they want to change, add, modify, or remove.

CONVERSATION HISTORY:
{context_str}

USER'S LATEST MESSAGE:
{transcript}

IMPORTANT: If the conversation history shows that you previously asked a question and the user's latest message is answering that question, you should:
1. Acknowledge the answer
2. Update the steps with the clarified information
3. Only ask new questions if there are still ambiguities

Your task is to identify:
1. **NEW STEPS**: Steps being added to the flow
2. **MODIFICATIONS**: Changes to existing steps (rewording, repositioning, or altering connections)
3. **DELETIONS**: Steps that should be removed
4. **REPLACEMENTS**: Steps that replace existing ones

CRITICAL PLACEMENT RULES:
- If the user says to add a step but does NOT specify WHERE (before/after which existing step), you MUST ask for clarification
- Only assume a placement if it's explicitly mentioned (e.g., "after step X", "before Y", "at the beginning", "at the end")
- If there are existing steps and the placement is ambiguous, ask: "Where should I add [step name]? Should it go after [list 2-3 relevant existing steps]?"
- NEVER default to placing steps after the start node unless explicitly stated

Be specific about:
- What changes are being made (add/modify/delete/replace)
- How changes relate to existing steps
- Any new decision points or branching logic
- The flow structure (sequential, parallel, branching)

Analyze the user's description and provide a structured clarification. You MUST respond with valid JSON only - no additional text before or after.

CRITICAL: Respond with ONLY this JSON format (no markdown, no additional text):
{{
  "steps": ["Step description (prefix with 'Add:', 'Modify:', 'Delete:', or 'Replace:' as appropriate)"],
  "structure": "Description of how the flow changes",
  "questions": ["Question 1 if needed"]
}}

Examples:
- "Add: Review with HR after budget implementation"
- "Modify: Change 'Submit request' to 'Submit detailed request form'"
- "Delete: Remove approval step"
- "Replace: Replace 'Email notification' with 'SMS notification'"

Example when placement is unclear:
- If user says "add bonus approval step" without specifying where, add to questions: "Where should I add the bonus approval step? After which existing step should it go?"

Example conversation flow:
User: "add set bonus targets by HR"
Assistant: {{"steps": ["Add: Set bonus targets by HR"], "structure": "Sequential", "questions": ["Where should I add 'Set bonus targets by HR'? After which existing step?"]}}

User: "after implementing local budget"
Assistant: {{"steps": ["Add: Set bonus targets by HR after the step 'implementing local budget'"], "structure": "Sequential", "questions": []}}

CRITICAL: When the user answers a placement question, include the placement information in the step description, e.g., "Add: [step name] after [existing step name]"

If there are no questions, use an empty array: "questions": []
"""

            messages = [
                {"role": "system", "content": "You are a helpful process analysis expert who clarifies business process descriptions."},
                {"role": "user", "content": clarification_prompt}
            ]
            
            response = self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                temperature=0.3,
                max_tokens=1000
            )
            
            content = response.choices[0].message.content.strip()
            
            # Try to parse JSON response
            try:
                clarification = json.loads(content)
                
                # Validate required fields
                if not isinstance(clarification.get('steps'), list):
                    clarification['steps'] = []
                if not isinstance(clarification.get('questions'), list):
                    clarification['questions'] = []
                if not clarification.get('structure'):
                    clarification['structure'] = "Sequential flow"
                
                print(f"✅ Process clarification successful: {len(clarification['steps'])} steps, {len(clarification['questions'])} questions")
                return clarification
                
            except json.JSONDecodeError:
                print(f"⚠️ Could not parse clarification JSON, using fallback")
                # Fallback: extract steps manually
                lines = content.split('\n')
                steps = []
                for line in lines:
                    if line.strip() and (line.strip().startswith('-') or line.strip().startswith('*') or line.strip()[0].isdigit()):
                        step = line.strip().lstrip('*-0123456789. ').strip()
                        if step:
                            steps.append(step)
                
                return {
                    "steps": steps if steps else ["Process step needs clarification"],
                    "structure": "Sequential flow (needs clarification)",
                    "questions": ["Could you clarify the specific steps and their sequence?"]
                }
                
        except Exception as e:
            print(f"Error in process clarification: {str(e)}")
            return None

    async def generate_flow_patch(
        self, transcript: str, context: Optional[str] = None, existing_flow = None
    ):
        """
        New pipeline: Extract Intent JSON → Translate to FlowPatch
        
        Args:
            transcript: Input transcript
            context: Optional context for incremental updates
            existing_flow: Optional existing ProcessFlow for incremental updates
            
        Returns:
            FlowPatch ready for PatchEngine.apply_patch()
        """
        # Step 1: Extract Intent JSON from LLM
        intent = await self.extract_process_intent(transcript, context, existing_flow)
        if not intent:
            return None
        
        # Step 2: Translate Intent to FlowPatch deterministically
        try:
            flow_patch = self.intent_translator.translate_intent_to_flow_patch(
                intent, existing_flow
            )
            return flow_patch
        except Exception as e:
            error_msg = str(e)
            print(f"Intent translation error: {error_msg}")
            
            # Return empty patch for connectivity issues (meaningless transcripts)
            if "disconnected" in error_msg.lower() or "invalid flows" in error_msg.lower():
                print("🔧 Returning empty patch for meaningless transcript")
                from schemas.process_flow import FlowPatch
                return FlowPatch(operations=[], source="intent_translator_empty")
            
            return None
    
    async def generate_flow_patch_multimodal(
        self, text: str, images: List[str], context: Optional[str] = None, existing_flow = None
    ):
        """
        New pipeline for multimodal input: Extract Intent JSON from text+images → Translate to FlowPatch
        
        Args:
            text: Input text
            images: List of base64-encoded images
            context: Optional context for incremental updates
            existing_flow: Optional existing ProcessFlow for incremental updates
            
        Returns:
            FlowPatch ready for PatchEngine.apply_patch()
        """
        # Step 1: Extract Intent JSON from LLM using multimodal input
        intent = await self.extract_process_intent_multimodal(text, images, context, existing_flow)
        if not intent:
            return None
        
        # Step 2: Translate Intent to FlowPatch deterministically
        try:
            flow_patch = self.intent_translator.translate_intent_to_flow_patch(
                intent, existing_flow
            )
            return flow_patch
        except Exception as e:
            error_msg = str(e)
            print(f"Intent translation error: {error_msg}")
            
            # Return empty patch for connectivity issues (meaningless transcripts)
            if "disconnected" in error_msg.lower() or "invalid flows" in error_msg.lower():
                print("🔧 Returning empty patch for meaningless transcript")
                from schemas.process_flow import FlowPatch
                return FlowPatch(operations=[], source="intent_translator_empty")
            
            return None
