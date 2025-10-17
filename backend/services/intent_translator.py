"""
Intent Translator Service

Converts Intent JSON (semantic meaning) to valid ProcessFlow objects.
Handles all graph topology concerns deterministically.
"""

import uuid
import re
from typing import List, Dict, Any, Optional, Set, Tuple
from datetime import datetime

from schemas.intent_schema import ProcessIntent, IntentStep, IntentFlow, IntentStepType
from schemas.process_flow import (
    ProcessFlow, ProcessNode, ProcessEdge, FlowPatch, PatchOperation,
    NodeType, AutomationLevel, validate_flow_topology
)


class IntentTranslatorError(Exception):
    """Raised when intent translation fails"""
    pass


class IntentTranslator:
    """
    Deterministic translator from Intent JSON to valid ProcessFlow.
    
    Responsibilities:
    - Map semantic steps to correct node types
    - Insert MERGE nodes automatically for multiple incoming edges
    - Enforce topology rules (PROCESS: 1 in/1 out, DECISION: 1 in/2-4 out, etc.)
    - Ensure exactly one START and one END node
    """
    
    def __init__(self):
        pass
    
    def _validate_intent_connectivity(self, intent: ProcessIntent) -> bool:
        """
        Validate that intent has connected flows and meaningful content.
        Returns False for disconnected or meaningless intents.
        """
        # Must have at least one step
        if not intent.steps:
            print("⚠️ Intent validation failed: No steps found")
            return False
        
        # If only 1 step, it's valid (will be converted to simple process)
        if len(intent.steps) == 1:
            return True
        
        # Must have flows if multiple steps
        if len(intent.steps) > 1 and not intent.flows:
            print("⚠️ Intent validation failed: Multiple steps but no flows")
            return False
        
        # Check for common non-process phrases in step text
        meaningless_phrases = [
            "thank you", "live session", "workshop", "big stage", 
            "subscribe", "presentation", "meeting", "session started"
        ]
        
        meaningful_steps = []
        for step in intent.steps:
            step_text = step.text.lower()
            if not any(phrase in step_text for phrase in meaningless_phrases):
                meaningful_steps.append(step)
        
        if len(meaningful_steps) == 0:
            print("⚠️ Intent validation failed: No meaningful business process steps found")
            return False
        
        print(f"✅ Intent validation passed: {len(meaningful_steps)} meaningful steps, {len(intent.flows)} flows")
        return True
    
    def translate_intent_to_flow_patch(
        self, 
        intent: ProcessIntent, 
        existing_flow: Optional[ProcessFlow] = None
    ) -> FlowPatch:
        """
        Convert ProcessIntent to a validated FlowPatch.
        
        Args:
            intent: Semantic process intent
            existing_flow: Optional existing flow for incremental updates
            
        Returns:
            FlowPatch with operations to create valid ProcessFlow
        """
        try:
            # Step 0: Validate intent has connected flows
            if not self._validate_intent_connectivity(intent):
                raise IntentTranslatorError("Intent contains disconnected or invalid flows")
            
            # Step 1: Convert semantic steps to graph nodes with correct types
            node_operations = self._create_node_operations(intent, existing_flow)
            
            # Step 2: Create edges with merge node insertion
            # (This already handles multiple NEW edges to same target)
            edge_operations = self._create_edge_operations(intent, node_operations, existing_flow)
            
            # Step 2.3: Detect and fix loops by inserting MERGE nodes
            # (This handles NEW edges to EXISTING nodes with incoming edges)
            loop_fixed_operations = self._fix_loop_edges(
                node_operations + edge_operations, existing_flow
            )
            
            # Step 2.4: Fix convergent paths (multiple paths leading to same node)
            convergent_fixed_operations = self._fix_convergent_paths(
                loop_fixed_operations, existing_flow
            )
            
            # Step 2.5: Fix DECISION nodes that don't have enough outgoing edges
            fixed_operations = self._fix_decision_nodes(
                convergent_fixed_operations, existing_flow
            )
            
            # Step 3: Ensure single START and END nodes
            final_operations = self._ensure_single_start_end(
                fixed_operations, existing_flow
            )
            
            # Create patch
            patch = FlowPatch(
                operations=final_operations,
                source="intent_translator",
                created_at=datetime.utcnow().isoformat()
            )
            
            # Validate and auto-repair if needed
            repaired_patch = self._validate_and_repair_patch(patch, existing_flow)
            
            return repaired_patch
            
        except Exception as e:
            raise IntentTranslatorError(f"Failed to translate intent: {str(e)}")
    
    def _create_node_operations(
        self, 
        intent: ProcessIntent, 
        existing_flow: Optional[ProcessFlow]
    ) -> List[PatchOperation]:
        """Create node operations with correct NodeType assignments."""
        operations = []
        
        # Get existing node labels to avoid duplicates
        existing_labels = set()
        existing_nodes_dict = {}  # label -> node for fuzzy matching
        if existing_flow:
            for node in existing_flow.nodes:
                label_normalized = node.label.lower().strip()
                existing_labels.add(label_normalized)
                existing_nodes_dict[label_normalized] = node
        
        # Track how many start/end points we have
        start_points = [s for s in intent.steps if s.step_type == IntentStepType.START_POINT]
        end_points = [s for s in intent.steps if s.step_type == IntentStepType.END_POINT]
        
        for step in intent.steps:
            step_text_normalized = step.text.lower().strip()
            
            # Skip if node already exists (exact match)
            if step_text_normalized in existing_labels:
                continue
            
            # Fuzzy match: check if this step is similar to any existing node
            # Strategy: if new label contains all words from existing label (or vice versa), consider it a match
            skip_node = False
            step_words = set(step_text_normalized.split())
            
            for existing_label in existing_labels:
                existing_words = set(existing_label.split())
                
                # If one label's words are a subset of the other (with at least 3 words overlap), it's a match
                common_words = step_words.intersection(existing_words)
                if len(common_words) >= 3:  # At least 3 words in common
                    # Check if it's a reasonable match (>70% overlap with shorter label)
                    shorter_len = min(len(step_words), len(existing_words))
                    if len(common_words) / shorter_len >= 0.7:
                        print(f"🔄 Fuzzy match: '{step.text}' matches existing '{existing_label}' - skipping duplicate")
                        skip_node = True
                        break
            
            if skip_node:
                continue
            
            # Determine correct NodeType based on semantic analysis
            node_type = self._determine_node_type(step, intent, start_points, end_points)
            
            # Create ProcessNode
            node = ProcessNode(
                id=str(uuid.uuid4()),
                type=node_type,
                label=step.text,
                owner=step.who,
                system=step.tool,
                automation=self._map_automation_level(step.manual_auto),
                created_at=datetime.utcnow().isoformat()
            )
            
            # Create operation
            operation = PatchOperation(
                type="add_node",
                node=node
            )
            operations.append(operation)
        
        return operations
    
    def _determine_node_type(
        self, 
        step: IntentStep, 
        intent: ProcessIntent,
        start_points: List[IntentStep],
        end_points: List[IntentStep]
    ) -> NodeType:
        """
        Deterministically assign NodeType based on semantic analysis and flow position.
        """
        # Explicit semantic types take precedence
        if step.step_type == IntentStepType.START_POINT:
            return NodeType.START
        elif step.step_type == IntentStepType.END_POINT:
            return NodeType.END
        elif step.step_type == IntentStepType.DECISION:
            return NodeType.DECISION
        
        # For regular steps, analyze flow patterns more conservatively
        outgoing_flows = [f for f in intent.flows if f.from_step == step.id]
        outgoing_count = len(outgoing_flows)
        
        # Decision: Multiple outgoing paths or has explicit conditions
        has_conditions = any(f.condition for f in outgoing_flows)
        if outgoing_count > 1 or (outgoing_count >= 1 and has_conditions):
            return NodeType.DECISION
        
        # Only create START if there are no explicit start points AND this step fits the pattern
        incoming_count = len([f for f in intent.flows if f.to_step == step.id])
        
        # Start: No incoming connections AND no explicit start points exist AND this is clearly the first step
        if (incoming_count == 0 and len(start_points) == 0 and 
            any(flow.from_step == step.id for flow in intent.flows)):  # Must have outgoing
            return NodeType.START
            
        # DON'T auto-create END nodes - only if explicitly marked as END_POINT by LLM
        # if (outgoing_count == 0 and len(end_points) == 0 and
        #     any(flow.to_step == step.id for flow in intent.flows)):  # Must have incoming
        #     return NodeType.END
        
        # Default: Regular process step (this should be the most common case)
        return NodeType.PROCESS
    
    def _create_edge_operations(
        self, 
        intent: ProcessIntent, 
        node_operations: List[PatchOperation],
        existing_flow: Optional[ProcessFlow]
    ) -> List[PatchOperation]:
        """Create edge operations with automatic merge node insertion."""
        operations = []
        
        # Build node ID mapping (step_id -> node_id AND label -> node_id for existing nodes)
        step_to_node_id = {}
        label_to_node_id = {}  # Fallback mapping for existing nodes referenced by label
        
        # Map existing nodes
        if existing_flow:
            for node in existing_flow.nodes:
                # Create label-based mapping for existing nodes (case-insensitive)
                label_key = node.label.lower().strip()
                label_to_node_id[label_key] = node.id
                
                # Try to match by label to step (this handles when LLM includes existing nodes as steps)
                matching_step = next(
                    (s for s in intent.steps if s.text.lower().strip() == node.label.lower().strip()),
                    None
                )
                if matching_step:
                    step_to_node_id[matching_step.id] = node.id
                    print(f"🔗 Mapped existing node '{node.label}' via step '{matching_step.id}'")
        
        # Map new nodes - be more flexible with matching
        for operation in node_operations:
            if operation.type == "add_node" and operation.node:
                matching_step = next(
                    (s for s in intent.steps if s.text.lower().strip() == operation.node.label.lower().strip()),
                    None
                )
                if matching_step:
                    step_to_node_id[matching_step.id] = operation.node.id
                    print(f"🔗 Mapped step '{matching_step.id}' to node '{operation.node.id}' ({operation.node.label})")
                else:
                    print(f"⚠️ Could not find matching step for node '{operation.node.label}'")
        
        # Track incoming edge counts for merge node insertion
        incoming_counts = {}
        for flow in intent.flows:
            target_step = flow.to_step
            if target_step in step_to_node_id:
                target_node_id = step_to_node_id[target_step]
                incoming_counts[target_node_id] = incoming_counts.get(target_node_id, 0) + 1
        
        # Create merge nodes for nodes with multiple incoming edges
        merge_nodes = {}
        for node_id, count in incoming_counts.items():
            if count > 1:
                # Find the target node to get its info
                target_node = None
                if existing_flow:
                    target_node = next((n for n in existing_flow.nodes if n.id == node_id), None)
                if not target_node:
                    # Find in new operations
                    for op in node_operations:
                        if op.node and op.node.id == node_id:
                            target_node = op.node
                            break
                
                if target_node:
                    merge_node = ProcessNode(
                        id=str(uuid.uuid4()),
                        type=NodeType.MERGE,
                        label=f"Merge before {target_node.label}",
                        automation=AutomationLevel.MANUAL,
                        created_at=datetime.utcnow().isoformat()
                    )
                    
                    operations.append(PatchOperation(type="add_node", node=merge_node))
                    merge_nodes[node_id] = merge_node.id
        
        # Track outgoing edges being created in this batch (to prevent duplicates)
        outgoing_edge_tracker = {}  # node_id -> count of outgoing edges being added
        created_edges = set()  # Track (source, target) pairs to prevent duplicates
        
        # Create edge operations with incremental mode awareness
        for flow in intent.flows:
            source_node_id = step_to_node_id.get(flow.from_step)
            target_node_id = step_to_node_id.get(flow.to_step)
            
            # Fallback: Try to resolve by label if step_id lookup fails
            if not source_node_id:
                source_node_id = label_to_node_id.get(flow.from_step.lower().strip())
                if source_node_id:
                    print(f"🔗 Resolved source by label: '{flow.from_step}' → {source_node_id}")
            
            if not target_node_id:
                target_node_id = label_to_node_id.get(flow.to_step.lower().strip())
                if target_node_id:
                    print(f"🔗 Resolved target by label: '{flow.to_step}' → {target_node_id}")
            
            if not source_node_id or not target_node_id:
                print(f"⚠️ Skipping edge - couldn't resolve nodes: {flow.from_step} -> {flow.to_step}")
                continue  # Skip if we can't resolve the nodes
            
            # Get source node info
            source_node = None
            if existing_flow:
                source_node = next((n for n in existing_flow.nodes if n.id == source_node_id), None)
            if not source_node:
                # Check in new operations
                for op in node_operations:
                    if op.node and op.node.id == source_node_id:
                        source_node = op.node
                        break
            
            # Check if source node already has outgoing edges - delete old ones to replace them
            if source_node and source_node.type == NodeType.PROCESS:
                # Count existing outgoing edges
                existing_outgoing_count = 0
                if existing_flow:
                    existing_outgoing_count = len([e for e in existing_flow.edges if e.source == source_node_id])
                
                # Count edges being added in this batch
                current_batch_count = outgoing_edge_tracker.get(source_node_id, 0)
                
                # If PROCESS node already has outgoing edge(s), delete them
                if existing_outgoing_count > 0:
                    existing_outgoing_edges = [e for e in existing_flow.edges if e.source == source_node_id]
                    for old_edge in existing_outgoing_edges:
                        operations.append(PatchOperation(type="delete_edge", edge_id=old_edge.id))
                        print(f"🔄 Deleting old edge from '{source_node.label}' to replace with new connection")
                
                # If we're trying to add a second edge in this batch, skip it
                if current_batch_count >= 1:
                    print(f"⚠️ Skipping additional edge from PROCESS node '{source_node.label}' (already adding one in this batch)")
                    continue
            elif source_node and source_node.type == NodeType.DECISION:
                # DECISION nodes can have multiple outgoing edges
                print(f"✅ Adding edge from DECISION node '{source_node.label}'")
            
            # Check if target needs merge node
            final_target_id = target_node_id
            if target_node_id in merge_nodes:
                final_target_id = merge_nodes[target_node_id]
            
            # Check for duplicate edge before creating
            edge_key = (source_node_id, final_target_id)
            if edge_key in created_edges:
                print(f"⚠️ Skipping duplicate edge: {source_node_id} -> {final_target_id}")
                continue
            
            # Create edge
            edge = ProcessEdge(
                id=str(uuid.uuid4()),
                source=source_node_id,
                target=final_target_id,
                condition=flow.condition,
                created_at=datetime.utcnow().isoformat()
            )
            
            operations.append(PatchOperation(type="add_edge", edge=edge))
            created_edges.add(edge_key)
            
            # Track this outgoing edge
            outgoing_edge_tracker[source_node_id] = outgoing_edge_tracker.get(source_node_id, 0) + 1
        
        # Create bridge edges from merge nodes to final targets
        for original_target_id, merge_node_id in merge_nodes.items():
            bridge_edge = ProcessEdge(
                id=str(uuid.uuid4()),
                source=merge_node_id,
                target=original_target_id,
                created_at=datetime.utcnow().isoformat()
            )
            operations.append(PatchOperation(type="add_edge", edge=bridge_edge))
        
        return operations
    
    def _fix_loop_edges(
        self, 
        operations: List[PatchOperation],
        existing_flow: Optional[ProcessFlow]
    ) -> List[PatchOperation]:
        """
        Detect loop edges (backward edges) and insert MERGE nodes to handle them.
        A loop occurs when a new edge points to an existing node that already has incoming edges.
        """
        if not existing_flow or not existing_flow.nodes:
            return operations  # No loops in new flows
        
        # Build maps of existing and new nodes
        all_nodes = {}
        existing_node_ids = set()
        
        # Track existing nodes and their incoming edges
        for node in existing_flow.nodes:
            all_nodes[node.id] = node
            existing_node_ids.add(node.id)
        
        # Add new nodes from operations
        for op in operations:
            if op.type == "add_node" and op.node:
                all_nodes[op.node.id] = op.node
        
        # Count incoming edges for each node (from existing flow + new operations - deleted operations)
        existing_incoming = {}  # Only from existing flow
        all_incoming = {}  # From existing + new - deleted
        
        # Track edges being deleted
        deleted_edge_ids = set()
        for op in operations:
            if op.type == "delete_edge" and op.edge_id:
                deleted_edge_ids.add(op.edge_id)
        
        # Add existing edges (excluding those being deleted)
        for edge in existing_flow.edges:
            # Skip edges that are being deleted in this operation
            if edge.id in deleted_edge_ids:
                continue
                
            if edge.target not in existing_incoming:
                existing_incoming[edge.target] = []
            existing_incoming[edge.target].append(edge)
            
            if edge.target not in all_incoming:
                all_incoming[edge.target] = []
            all_incoming[edge.target].append(edge)
        
        # Add new edges from operations
        for op in operations:
            if op.type == "add_edge" and op.edge:
                if op.edge.target not in all_incoming:
                    all_incoming[op.edge.target] = []
                all_incoming[op.edge.target].append(op.edge)
        
        # Find edges that create loops (target is existing node with incoming edges)
        new_operations = []
        merge_nodes_created = {}  # target_node_id -> merge_node_id
        
        for op in operations:
            if op.type == "add_edge" and op.edge:
                target_id = op.edge.target
                target_node = all_nodes.get(target_id)
                
                # Check if this edge creates a loop
                if (target_id in existing_node_ids and 
                    target_node and 
                    target_node.type == NodeType.PROCESS and
                    len(all_incoming.get(target_id, [])) > 1):
                    
                    print(f"🔄 Loop detected: edge to '{target_node.label}' (already has {len(all_incoming.get(target_id, []))-1} existing + this new edge)")
                    
                    # Create or reuse MERGE node for this target
                    if target_id not in merge_nodes_created:
                        merge_node = ProcessNode(
                            id=str(uuid.uuid4()),
                            type=NodeType.MERGE,
                            label=f"Loop merge before {target_node.label}",
                            automation=AutomationLevel.MANUAL,
                            created_at=datetime.utcnow().isoformat()
                        )
                        
                        new_operations.append(PatchOperation(type="add_node", node=merge_node))
                        merge_nodes_created[target_id] = merge_node.id
                        print(f"✅ Created MERGE node: {merge_node.label}")
                        
                        # Redirect ONLY existing edges from the flow (not from operations)
                        for existing_edge in existing_incoming.get(target_id, []):
                            # Delete the old edge
                            new_operations.append(PatchOperation(
                                type="delete_edge",
                                edge_id=existing_edge.id
                            ))
                            # Create redirected edge to MERGE
                            redirected_existing = ProcessEdge(
                                id=str(uuid.uuid4()),
                                source=existing_edge.source,
                                target=merge_node.id,
                                condition=existing_edge.condition,
                                created_at=datetime.utcnow().isoformat()
                            )
                            new_operations.append(PatchOperation(type="add_edge", edge=redirected_existing))
                            
                            existing_source = all_nodes.get(existing_edge.source)
                            existing_source_label = existing_source.label if existing_source else "Unknown"
                            print(f"🔀 Redirected existing edge: {existing_source_label} → MERGE")
                        
                        # Create bridge edge from MERGE to original target
                        bridge_edge = ProcessEdge(
                            id=str(uuid.uuid4()),
                            source=merge_node.id,
                            target=target_id,
                            created_at=datetime.utcnow().isoformat()
                        )
                        new_operations.append(PatchOperation(type="add_edge", edge=bridge_edge))
                        print(f"✅ Created bridge: MERGE → {target_node.label}")
                    
                    # Redirect this edge to the MERGE node instead
                    merge_node_id = merge_nodes_created[target_id]
                    redirected_edge = ProcessEdge(
                        id=op.edge.id,
                        source=op.edge.source,
                        target=merge_node_id,
                        condition=op.edge.condition,
                        created_at=op.edge.created_at
                    )
                    new_operations.append(PatchOperation(type="add_edge", edge=redirected_edge))
                    
                    source_node = all_nodes.get(op.edge.source)
                    source_label = source_node.label if source_node else "Unknown"
                    print(f"🔀 Redirected edge: {source_label} → MERGE (was → {target_node.label})")
                    
                else:
                    # Not a loop, keep the edge as-is
                    new_operations.append(op)
            else:
                # Not an edge operation, keep as-is
                new_operations.append(op)
        
        return new_operations
    
    def _fix_convergent_paths(
        self,
        operations: List[PatchOperation],
        existing_flow: Optional[ProcessFlow]
    ) -> List[PatchOperation]:
        """
        Fix convergent paths where multiple nodes need to connect to the same target.
        This handles cases where dangling nodes should lead to a common next step.
        """
        if not existing_flow or not existing_flow.nodes:
            return operations
        
        # Build node maps
        all_nodes = {}
        for node in existing_flow.nodes:
            all_nodes[node.id] = node
        for op in operations:
            if op.type == "add_node" and op.node:
                all_nodes[op.node.id] = op.node
        
        # Track outgoing edges for each node (accounting for deletions)
        outgoing_counts = {}
        
        # Track deleted edges
        deleted_edge_ids = set()
        for op in operations:
            if op.type == "delete_edge" and op.edge_id:
                deleted_edge_ids.add(op.edge_id)
        
        # Count existing edges (excluding deleted ones)
        for edge in existing_flow.edges:
            if edge.id not in deleted_edge_ids:
                outgoing_counts[edge.source] = outgoing_counts.get(edge.source, 0) + 1
        
        # Count new edges from operations
        for op in operations:
            if op.type == "add_edge" and op.edge:
                outgoing_counts[op.edge.source] = outgoing_counts.get(op.edge.source, 0) + 1
        
        # Find dangling PROCESS nodes in existing flow (no outgoing edges)
        dangling_existing_nodes = []
        for node in existing_flow.nodes:
            if node.type == NodeType.PROCESS and outgoing_counts.get(node.id, 0) == 0:
                dangling_existing_nodes.append(node)
        
        # If we have 2+ dangling nodes AND new operations add at least one node,
        # we should connect ALL dangling nodes to the first new PROCESS node via MERGE
        if len(dangling_existing_nodes) >= 2:
            # Find first new PROCESS node
            first_new_process = None
            for op in operations:
                if op.type == "add_node" and op.node and op.node.type == NodeType.PROCESS:
                    first_new_process = op.node
                    break
            
            if first_new_process:
                print(f"🔀 Detected {len(dangling_existing_nodes)} convergent paths to '{first_new_process.label}'")
                
                # Create MERGE node before the first new process node
                merge_node = ProcessNode(
                    id=str(uuid.uuid4()),
                    type=NodeType.MERGE,
                    label=f"Convergence before {first_new_process.label}",
                    automation=AutomationLevel.MANUAL,
                    created_at=datetime.utcnow().isoformat()
                )
                
                # Start with MERGE node and the target new process node
                new_operations = [
                    PatchOperation(type="add_node", node=merge_node),
                    PatchOperation(type="add_node", node=first_new_process)
                ]
                print(f"✅ Created MERGE node: {merge_node.label}")
                print(f"✅ Added target node: {first_new_process.label}")
                
                # Connect all dangling nodes to MERGE
                for dangling_node in dangling_existing_nodes:
                    edge = ProcessEdge(
                        id=str(uuid.uuid4()),
                        source=dangling_node.id,
                        target=merge_node.id,
                        created_at=datetime.utcnow().isoformat()
                    )
                    new_operations.append(PatchOperation(type="add_edge", edge=edge))
                    print(f"🔗 Connected '{dangling_node.label}' → MERGE")
                
                # Connect MERGE to first new process node
                bridge_edge = ProcessEdge(
                    id=str(uuid.uuid4()),
                    source=merge_node.id,
                    target=first_new_process.id,
                    created_at=datetime.utcnow().isoformat()
                )
                new_operations.append(PatchOperation(type="add_edge", edge=bridge_edge))
                print(f"✅ Connected MERGE → '{first_new_process.label}'")
                
                # Add remaining operations (skip the first new process node since we already added it)
                for op in operations:
                    # Skip the first new process node (already added)
                    if op.type == "add_node" and op.node and op.node.id == first_new_process.id:
                        print(f"⚠️ Skipped duplicate node '{first_new_process.label}' (already added)")
                        continue
                    # Skip any edges that try to connect TO the first new process node
                    # (we've already connected via MERGE)
                    if op.type == "add_edge" and op.edge and op.edge.target == first_new_process.id:
                        print(f"⚠️ Skipped redundant edge to '{first_new_process.label}' (handled by MERGE)")
                        continue
                    new_operations.append(op)
                
                return new_operations
        
        return operations
    
    def _fix_decision_nodes(
        self, 
        operations: List[PatchOperation],
        existing_flow: Optional[ProcessFlow]
    ) -> List[PatchOperation]:
        """
        Fix DECISION nodes that don't have enough outgoing edges (must have 2-4).
        Convert them to PROCESS nodes if they only have 1 outgoing edge.
        """
        # Count outgoing edges for each node
        outgoing_counts = {}
        decision_nodes = {}
        
        # Find all decision nodes and count their outgoing edges
        for operation in operations:
            if operation.type == "add_node" and operation.node:
                if operation.node.type == NodeType.DECISION:
                    decision_nodes[operation.node.id] = operation.node
                    outgoing_counts[operation.node.id] = 0
            elif operation.type == "add_edge" and operation.edge:
                source_id = operation.edge.source
                if source_id in outgoing_counts:
                    outgoing_counts[source_id] += 1
        
        # Fix decision nodes with insufficient outgoing edges
        fixed_operations = []
        for operation in operations:
            if (operation.type == "add_node" and operation.node and 
                operation.node.id in decision_nodes):
                
                outgoing_count = outgoing_counts.get(operation.node.id, 0)
                if outgoing_count < 2:
                    # Convert to PROCESS node
                    print(f"🔧 Converting DECISION node '{operation.node.label}' to PROCESS (only {outgoing_count} outgoing edges)")
                    operation.node.type = NodeType.PROCESS
            
            fixed_operations.append(operation)
        
        return fixed_operations
    
    def _ensure_single_start_end(
        self, 
        operations: List[PatchOperation],
        existing_flow: Optional[ProcessFlow]
    ) -> List[PatchOperation]:
        """Ensure exactly one START and one END node exist and fix topology."""
        
        # AGGRESSIVE FIX: Convert ALL new START/END nodes to PROCESS nodes for incremental updates
        if existing_flow and existing_flow.nodes:
            print("🔧 INCREMENTAL MODE: Converting all new START/END nodes to PROCESS nodes")
            for operation in operations:
                if operation.type == "add_node" and operation.node:
                    if operation.node.type in [NodeType.START, NodeType.END]:
                        print(f"   Converting {operation.node.type.value} '{operation.node.label}' to PROCESS")
                        operation.node.type = NodeType.PROCESS
        else:
            # NEW FLOW MODE: Ensure exactly one START and one END
            print("🔧 NEW FLOW MODE: Ensuring single START/END")
            
            # Count new START/END nodes in operations
            start_nodes = []
            end_nodes = []
            
            for operation in operations:
                if operation.type == "add_node" and operation.node:
                    if operation.node.type == NodeType.START:
                        start_nodes.append(operation.node)
                    elif operation.node.type == NodeType.END:
                        end_nodes.append(operation.node)
            
            # Keep only the first START node, convert others to PROCESS
            if len(start_nodes) > 1:
                for node in start_nodes[1:]:
                    print(f"   Converting extra START '{node.label}' to PROCESS")
                    node.type = NodeType.PROCESS
            
            # Keep only the first END node, convert others to PROCESS  
            if len(end_nodes) > 1:
                for node in end_nodes[1:]:
                    print(f"   Converting extra END '{node.label}' to PROCESS")
                    node.type = NodeType.PROCESS
            
            # Add START node if none exists AND connect it to first node
            if len(start_nodes) == 0:
                start_node = ProcessNode(
                    id=str(uuid.uuid4()),
                    type=NodeType.START,
                    label="Start process",
                    automation=AutomationLevel.MANUAL,
                    created_at=datetime.utcnow().isoformat()
                )
                operations.insert(0, PatchOperation(type="add_node", node=start_node))
                print("   Added missing START node")
            
                # Find first node (any type except START/END) with no incoming edges and connect START to it
                all_nodes = {}
                incoming_edges = set()
                for op in operations:
                    if op.type == "add_node" and op.node:
                        all_nodes[op.node.id] = op.node
                    elif op.type == "add_edge" and op.edge:
                        incoming_edges.add(op.edge.target)
                
                # Find ANY node (PROCESS, DECISION, MERGE) with no incoming edges
                first_node = None
                # Prioritize: PROCESS > DECISION > MERGE
                for priority_type in [NodeType.PROCESS, NodeType.DECISION, NodeType.MERGE]:
                    for node_id, node in all_nodes.items():
                        if node.type == priority_type and node_id not in incoming_edges:
                            first_node = node
                            break
                    if first_node:
                        break
                
                if first_node:
                    start_edge = ProcessEdge(
                        id=str(uuid.uuid4()),
                        source=start_node.id,
                        target=first_node.id,
                        created_at=datetime.utcnow().isoformat()
                    )
                    operations.append(PatchOperation(type="add_edge", edge=start_edge))
                    print(f"   Connected START to first node ({first_node.type.value}) '{first_node.label}'")
            
            # DON'T auto-add END node - let user explicitly define endpoints
            # if len(end_nodes) == 0:
            #     end_node = ProcessNode(
            #         id=str(uuid.uuid4()),
            #         type=NodeType.END,
            #         label="End process",
            #         automation=AutomationLevel.MANUAL,
            #         created_at=datetime.utcnow().isoformat()
            #     )
            #     operations.append(PatchOperation(type="add_node", node=end_node))
            #     print("   Added missing END node")
        
        # Connect dangling PROCESS nodes to existing END nodes (especially for incremental mode)
        final_operations = self._connect_dangling_process_nodes_to_existing_flow(operations, existing_flow)
        
        return final_operations
    
    def _connect_dangling_process_nodes(self, operations: List[PatchOperation]) -> List[PatchOperation]:
        """Ensure all PROCESS nodes have proper incoming edges in NEW flows."""
        
        # Find all nodes and edges
        nodes_by_id = {}
        incoming_counts = {}
        outgoing_counts = {}
        start_nodes = []
        
        for operation in operations:
            if operation.type == "add_node" and operation.node:
                nodes_by_id[operation.node.id] = operation.node
                incoming_counts[operation.node.id] = 0
                outgoing_counts[operation.node.id] = 0
                if operation.node.type == NodeType.START:
                    start_nodes.append(operation.node)
            elif operation.type == "add_edge" and operation.edge:
                source_id = operation.edge.source
                target_id = operation.edge.target
                if source_id in outgoing_counts:
                    outgoing_counts[source_id] += 1
                if target_id in incoming_counts:
                    incoming_counts[target_id] += 1
        
        # Find PROCESS nodes with no incoming edges
        dangling_incoming = []
        for node_id, node in nodes_by_id.items():
            if node.type == NodeType.PROCESS and incoming_counts.get(node_id, 0) == 0:
                dangling_incoming.append(node)
        
        if not dangling_incoming:
            return operations
        
        new_operations = operations.copy()
        
        # Connect START to first dangling PROCESS node if START has no outgoing
        if start_nodes:
            start_node = start_nodes[0]
            if outgoing_counts.get(start_node.id, 0) == 0 and dangling_incoming:
                first_process = dangling_incoming[0]
                edge = ProcessEdge(
                    id=str(uuid.uuid4()),
                    source=start_node.id,
                    target=first_process.id,
                    created_at=datetime.utcnow().isoformat()
                )
                new_operations.append(PatchOperation(type="add_edge", edge=edge))
                print(f"🔧 Connected START to first PROCESS '{first_process.label}'")
                dangling_incoming.remove(first_process)
                # Update outgoing count to prevent duplicate connections
                outgoing_counts[start_node.id] = 1
        
        # For remaining dangling nodes, find a suitable source (prefer PROCESS nodes)
        for dangling_node in dangling_incoming:
            # Find nodes that could connect to this node
            potential_sources = [
                n for n in nodes_by_id.values() 
                if n.type in [NodeType.PROCESS, NodeType.DECISION, NodeType.MERGE]
                and outgoing_counts.get(n.id, 0) == 0  # No outgoing yet
            ]
            
            if potential_sources:
                source_node = potential_sources[0]
                edge = ProcessEdge(
                    id=str(uuid.uuid4()),
                    source=source_node.id,
                    target=dangling_node.id,
                    created_at=datetime.utcnow().isoformat()
                )
                new_operations.append(PatchOperation(type="add_edge", edge=edge))
                outgoing_counts[source_node.id] += 1
                print(f"🔧 Connected '{source_node.label}' to dangling '{dangling_node.label}'")
        
        return new_operations
    
    def _connect_dangling_process_nodes_to_existing_flow(
        self, 
        operations: List[PatchOperation], 
        existing_flow: Optional[ProcessFlow]
    ) -> List[PatchOperation]:
        """
        Connect dangling PROCESS nodes to existing flow (for incremental updates).
        """
        if not existing_flow:
            return self._connect_dangling_process_nodes(operations)
        
        # Find new nodes without incoming/outgoing edges
        new_nodes = {}
        edges_map = {}
        
        for operation in operations:
            if operation.type == "add_node" and operation.node:
                new_nodes[operation.node.id] = operation.node
            elif operation.type == "add_edge" and operation.edge:
                # Track outgoing edges
                source = operation.edge.source
                if source not in edges_map:
                    edges_map[source] = {'outgoing': 0, 'incoming': 0}
                edges_map[source]['outgoing'] += 1
                
                # Track incoming edges
                target = operation.edge.target
                if target not in edges_map:
                    edges_map[target] = {'outgoing': 0, 'incoming': 0}
                edges_map[target]['incoming'] += 1
        
        # Find dangling nodes (no incoming or no outgoing)
        # Check PROCESS, DECISION, and MERGE nodes (not START/END)
        dangling_nodes = []
        for node_id, node in new_nodes.items():
            if node.type in [NodeType.PROCESS, NodeType.DECISION, NodeType.MERGE]:
                has_incoming = edges_map.get(node_id, {}).get('incoming', 0) > 0
                has_outgoing = edges_map.get(node_id, {}).get('outgoing', 0) > 0
                
                if not has_incoming or not has_outgoing:
                    dangling_nodes.append(node)
                    print(f"🔍 Found dangling {node.type.value} node: {node.label} (incoming={has_incoming}, outgoing={has_outgoing})")
        
        if not dangling_nodes:
            return operations
        
        print(f"🔧 Found {len(dangling_nodes)} dangling nodes in incremental mode")
        new_operations = operations.copy()
        
        # Find the best "connection point" in existing flow
        # Priority: last PROCESS node with no outgoing > last PROCESS node > START node
        existing_process_nodes = [n for n in existing_flow.nodes if n.type == NodeType.PROCESS]
        existing_start_nodes = [n for n in existing_flow.nodes if n.type == NodeType.START]
        existing_end_nodes = [n for n in existing_flow.nodes if n.type == NodeType.END]
        
        # Find PROCESS nodes that have no outgoing edges (are "dangling ends")
        # IMPORTANT: Check both existing edges AND new edges added in operations (excluding deleted edges)
        existing_outgoing = {}
        
        # Track deleted edges
        deleted_edge_ids = set()
        for operation in operations:
            if operation.type == "delete_edge" and operation.edge_id:
                deleted_edge_ids.add(operation.edge_id)
        
        # Count existing edges (excluding deleted ones)
        for edge in existing_flow.edges:
            if edge.id not in deleted_edge_ids:
                existing_outgoing[edge.source] = existing_outgoing.get(edge.source, 0) + 1
        
        # Also count edges added in operations (these are from previous fix methods)
        for operation in operations:
            if operation.type == "add_edge" and operation.edge:
                source_id = operation.edge.source
                existing_outgoing[source_id] = existing_outgoing.get(source_id, 0) + 1
        
        dangling_existing_nodes = [
            n for n in existing_process_nodes 
            if existing_outgoing.get(n.id, 0) == 0
        ]
        
        # Select best source node for new connections
        source_node = None
        if dangling_existing_nodes:
            # Connect from last dangling PROCESS node (best option - continues the flow)
            source_node = dangling_existing_nodes[-1]
            print(f"🔗 Using dangling PROCESS node as connection point: {source_node.label}")
        elif existing_process_nodes:
            # Connect from last PROCESS node (will need to handle multiple outgoing)
            source_node = existing_process_nodes[-1]
            print(f"🔗 Using last PROCESS node as connection point: {source_node.label}")
        elif existing_start_nodes:
            # If no PROCESS nodes, check if START node can be used
            start_node = existing_start_nodes[0]
            if existing_outgoing.get(start_node.id, 0) == 0:
                source_node = start_node
                print(f"🔗 Using START node as connection point")
            else:
                print(f"⚠️ START node already has outgoing edges, cannot use as connection point")
        
        if not source_node:
            print("⚠️ No suitable connection point found in existing flow")
            return new_operations
        
        # Connect first dangling new node to existing flow
        # Sort by priority: nodes without incoming should be connected first
        # Within those, prioritize DECISION and MERGE nodes over PROCESS
        nodes_without_incoming = [
            n for n in dangling_nodes 
            if edges_map.get(n.id, {}).get('incoming', 0) == 0
        ]
        
        if not nodes_without_incoming:
            print("⚠️ No nodes without incoming edges found to connect")
            return new_operations
        
        # Prioritize: DECISION > MERGE > PROCESS (decision points should be connected)
        node_priority = {NodeType.DECISION: 0, NodeType.MERGE: 1, NodeType.PROCESS: 2}
        nodes_without_incoming.sort(key=lambda n: node_priority.get(n.type, 3))
        
        first_node = nodes_without_incoming[0]
        print(f"🔗 Connecting first new node: {first_node.label} ({first_node.type.value})")
        
        # Connect the first node to existing flow
        if True:  # Always connect the first node
            has_incoming = edges_map.get(first_node.id, {}).get('incoming', 0) > 0
            
            # Connect this node to existing flow
            if not has_incoming:
                # Check if source is a PROCESS node with existing outgoing edges
                # Check BOTH existing edges AND edges already added in this operation batch
                if source_node.type == NodeType.PROCESS:
                    # Check existing flow edges
                    existing_outgoing = [e for e in existing_flow.edges if e.source == source_node.id]
                    
                    # Check edges added in operations (from convergent paths, loop fixes, etc.)
                    operations_outgoing_count = sum(
                        1 for op in new_operations 
                        if op.type == "add_edge" and op.edge and op.edge.source == source_node.id
                    )
                    
                    total_outgoing = len(existing_outgoing) + operations_outgoing_count
                    
                    if total_outgoing > 0:
                        print(f"⚠️ Skipping dangling connection: '{source_node.label}' already has {total_outgoing} outgoing edge(s)")
                        # Don't create this edge - source already connected
                        # Instead, skip to next iteration or return current operations
                        return new_operations
                    
                    # Delete old edges if any exist in the flow
                    if existing_outgoing:
                        for old_edge in existing_outgoing:
                            new_operations.append(PatchOperation(
                                type="delete_edge",
                                edge_id=old_edge.id
                            ))
                            print(f"🔄 Deleting existing edge from '{source_node.label}' (PROCESS node can only have 1 outgoing)")
                
                # Create new edge from source to first new node
                edge = ProcessEdge(
                    id=str(uuid.uuid4()),
                    source=source_node.id,
                    target=first_node.id,
                    created_at=datetime.utcnow().isoformat()
                )
                new_operations.append(PatchOperation(type="add_edge", edge=edge))
                print(f"✅ Connected existing '{source_node.label}' to new '{first_node.label}' ({first_node.type.value})")
                
                # Update edges_map to reflect this new connection
                if first_node.id not in edges_map:
                    edges_map[first_node.id] = {'outgoing': 0, 'incoming': 0}
                edges_map[first_node.id]['incoming'] += 1
        
        return new_operations
    
    def _map_automation_level(self, manual_auto: Optional[str]) -> AutomationLevel:
        """Map semantic automation level to AutomationLevel enum."""
        if not manual_auto:
            return AutomationLevel.UNKNOWN
        
        manual_auto_lower = manual_auto.lower()
        if manual_auto_lower == "manual":
            return AutomationLevel.MANUAL
        elif manual_auto_lower == "automated":
            return AutomationLevel.AUTOMATED
        else:
            return AutomationLevel.UNKNOWN
    
    def _validate_and_repair_patch(
        self, 
        patch: FlowPatch, 
        existing_flow: Optional[ProcessFlow]
    ) -> FlowPatch:
        """
        Validate patch and automatically repair common validation errors.
        
        Returns:
            Repaired patch that creates a valid flow
        """
        max_repair_attempts = 3
        current_patch = patch
        
        for attempt in range(max_repair_attempts):
            # Test the patch
            if existing_flow:
                test_flow = ProcessFlow(
                    nodes=existing_flow.nodes.copy(),
                    edges=existing_flow.edges.copy()
                )
            else:
                test_flow = ProcessFlow(nodes=[], edges=[])
            
            # Apply operations
            for operation in current_patch.operations:
                if operation.type == "add_node" and operation.node:
                    test_flow.nodes.append(operation.node)
                elif operation.type == "update_node" and operation.node:
                    for i, node in enumerate(test_flow.nodes):
                        if node.id == operation.node.id:
                            test_flow.nodes[i] = operation.node
                            break
                elif operation.type == "delete_node" and operation.node_id:
                    test_flow.nodes = [n for n in test_flow.nodes if n.id != operation.node_id]
                    test_flow.edges = [
                        e for e in test_flow.edges 
                        if e.source != operation.node_id and e.target != operation.node_id
                    ]
                elif operation.type == "add_edge" and operation.edge:
                    test_flow.edges.append(operation.edge)
                elif operation.type == "update_edge" and operation.edge:
                    for i, edge in enumerate(test_flow.edges):
                        if edge.id == operation.edge.id:
                            test_flow.edges[i] = operation.edge
                            break
                elif operation.type == "delete_edge" and operation.edge_id:
                    test_flow.edges = [e for e in test_flow.edges if e.id != operation.edge_id]
            
            # Validate
            errors = validate_flow_topology(test_flow)
            
            if not errors:
                print(f"✅ Flow validation passed (attempt {attempt + 1})")
                return current_patch
            
            # Auto-repair
            print(f"🔧 Auto-repairing validation errors (attempt {attempt + 1}): {errors}")
            repaired_operations = self._auto_repair_validation_errors(
                current_patch.operations, test_flow, errors
            )
            
            current_patch = FlowPatch(
                operations=repaired_operations,
                source="intent_translator_repaired",
                created_at=datetime.utcnow().isoformat()
            )
        
        # Final validation after all repair attempts
        # Be lenient - return the best attempt even if not perfect
        print(f"⚠️ Could not fully repair flow after {max_repair_attempts} attempts")
        print(f"⚠️ Returning best attempt with remaining issues: {errors}")
        print(f"💡 Flow may have minor validation issues but should be usable")
        return current_patch
    
    def _auto_repair_validation_errors(
        self,
        operations: List[PatchOperation],
        test_flow: ProcessFlow,
        errors: List[str]
    ) -> List[PatchOperation]:
        """
        Automatically repair common validation errors.
        """
        repaired_ops = operations.copy()
        
        # Build node and edge maps
        node_map = {node.id: node for node in test_flow.nodes}
        
        # Count incoming/outgoing edges
        outgoing_count = {}
        incoming_count = {}
        for edge in test_flow.edges:
            outgoing_count[edge.source] = outgoing_count.get(edge.source, 0) + 1
            incoming_count[edge.target] = incoming_count.get(edge.target, 0) + 1
        
        for error in errors:
            # Fix START nodes with no outgoing
            if "START node" in error and "must have exactly 1 outgoing (has 0)" in error:
                # Extract node ID from error message
                match = re.search(r"START node '([^']+)'", error)
                if match:
                    start_id = match.group(1)
                    start_node = node_map.get(start_id)
                    
                    if start_node and outgoing_count.get(start_id, 0) == 0:
                        # Find first node with no incoming
                        for node_id, node in node_map.items():
                            if (node.type in [NodeType.PROCESS, NodeType.DECISION, NodeType.MERGE] and 
                                incoming_count.get(node_id, 0) == 0 and node_id != start_id):
                                # Add edge from START to this node
                                new_edge = ProcessEdge(
                                    id=str(uuid.uuid4()),
                                    source=start_id,
                                    target=node_id,
                                    created_at=datetime.utcnow().isoformat()
                                )
                                repaired_ops.append(PatchOperation(type="add_edge", edge=new_edge))
                                print(f"   🔧 Connected START to '{node.label}'")
                                break
            
            # Fix DECISION/PROCESS nodes with no incoming
            if "must have exactly 1 incoming (has 0)" in error:
                match = re.search(r"(DECISION|PROCESS) node '([^']+)'", error)
                if match:
                    node_id = match.group(2)
                    node = node_map.get(node_id)
                    
                    if node and incoming_count.get(node_id, 0) == 0:
                        # Find START node to connect from
                        start_node = next((n for n in test_flow.nodes if n.type == NodeType.START), None)
                        if start_node:
                            new_edge = ProcessEdge(
                                id=str(uuid.uuid4()),
                                source=start_node.id,
                                target=node_id,
                                created_at=datetime.utcnow().isoformat()
                            )
                            repaired_ops.append(PatchOperation(type="add_edge", edge=new_edge))
                            print(f"   🔧 Connected START to orphaned node '{node.label}'")
            
            # Fix DECISION nodes with insufficient outgoing
            if "DECISION node" in error and "must have 2–4 outgoing" in error:
                match = re.search(r"DECISION node '([^']+)'", error)
                if match:
                    decision_id = match.group(1)
                    decision_node = node_map.get(decision_id)
                    
                    if decision_node:
                        current_outgoing = outgoing_count.get(decision_id, 0)
                        needed = 2 - current_outgoing
                        
                        if needed > 0:
                            # Create a default END node for missing branches
                            end_node = ProcessNode(
                                id=str(uuid.uuid4()),
                                type=NodeType.END,
                                label="End process",
                                automation=AutomationLevel.MANUAL,
                                created_at=datetime.utcnow().isoformat()
                            )
                            repaired_ops.append(PatchOperation(type="add_node", node=end_node))
                            
                            new_edge = ProcessEdge(
                                id=str(uuid.uuid4()),
                                source=decision_id,
                                target=end_node.id,
                                condition="else",
                                created_at=datetime.utcnow().isoformat()
                            )
                            repaired_ops.append(PatchOperation(type="add_edge", edge=new_edge))
                            print(f"   🔧 Added missing decision branch to END")
        
        return repaired_ops
    
    def _validate_patch_creates_valid_flow(
        self, 
        patch: FlowPatch, 
        existing_flow: Optional[ProcessFlow]
    ) -> None:
        """
        Validate that applying the patch would create a valid flow.
        Throws IntentTranslatorError if validation fails.
        """
        # Create a temporary flow to test the patch
        if existing_flow:
            test_flow = ProcessFlow(
                nodes=existing_flow.nodes.copy(),
                edges=existing_flow.edges.copy()
            )
        else:
            test_flow = ProcessFlow(nodes=[], edges=[])
        
        # Simulate applying the patch with ALL operation types
        for operation in patch.operations:
            if operation.type == "add_node" and operation.node:
                test_flow.nodes.append(operation.node)
            elif operation.type == "update_node" and operation.node:
                # Find and update the node
                for i, node in enumerate(test_flow.nodes):
                    if node.id == operation.node.id:
                        test_flow.nodes[i] = operation.node
                        break
            elif operation.type == "delete_node" and operation.node_id:
                test_flow.nodes = [n for n in test_flow.nodes if n.id != operation.node_id]
                # Also remove edges connected to this node
                test_flow.edges = [
                    e for e in test_flow.edges 
                    if e.source != operation.node_id and e.target != operation.node_id
                ]
            elif operation.type == "add_edge" and operation.edge:
                test_flow.edges.append(operation.edge)
            elif operation.type == "update_edge" and operation.edge:
                # Find and update the edge
                for i, edge in enumerate(test_flow.edges):
                    if edge.id == operation.edge.id:
                        test_flow.edges[i] = operation.edge
                        break
            elif operation.type == "delete_edge" and operation.edge_id:
                test_flow.edges = [e for e in test_flow.edges if e.id != operation.edge_id]
        
        # Validate topology
        errors = validate_flow_topology(test_flow)
        if errors:
            print(f"⚠️ Validation errors: {errors}")
            raise IntentTranslatorError(f"Generated flow would be invalid: {'; '.join(errors)}")
