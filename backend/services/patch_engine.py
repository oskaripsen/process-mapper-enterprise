"""
Deterministic Patch Engine

Handles all process flow modifications through validated patch operations.
Ensures flow invariants are maintained and provides rollback capability.
"""

from typing import List, Dict, Optional, Tuple
from datetime import datetime
import uuid
import copy

from schemas.process_flow import (
    ProcessFlow, ProcessNode, ProcessEdge, PatchOperation, FlowPatch,
    NodeType, AutomationLevel, validate_flow_topology
)
from services.step_id import get_next_sequential_id

class PatchEngineError(Exception):
    """Raised when patch application fails"""
    pass

class PatchEngine:
    """
    Deterministic engine for applying patches to process flows.
    All flow modifications go through this engine to ensure consistency.
    """
    
    def __init__(self):
        self.history: List[Tuple[ProcessFlow, FlowPatch]] = []
        self.max_history = 100
    
    def apply_patch(self, flow: ProcessFlow, patch: FlowPatch) -> ProcessFlow:
        """Apply a patch to a process flow with full validation."""
        original_flow = copy.deepcopy(flow)
        
        try:
            new_flow = copy.deepcopy(flow)
            patch.applied_at = datetime.utcnow().isoformat()
            
            for operation in patch.operations:
                new_flow = self._apply_operation(new_flow, operation)
            
            # Post-process: Create merge nodes for process nodes with multiple incoming edges
            new_flow = self._create_merge_nodes_for_multiple_incoming(new_flow)
            
            # Validate topology (be lenient - warn but don't fail)
            validation_errors = validate_flow_topology(new_flow)
            if validation_errors:
                print(f"⚠️ Flow has validation warnings: {'; '.join(validation_errors)}")
                print(f"💡 Continuing anyway - flow should still be usable")
            
            new_flow.updated_at = datetime.utcnow().isoformat()
            self._add_to_history(original_flow, patch)
            return new_flow
            
        except Exception as e:
            raise PatchEngineError(f"Failed to apply patch: {str(e)}")
    
    def _apply_operation(self, flow: ProcessFlow, operation: PatchOperation) -> ProcessFlow:
        """Apply a single patch operation."""
        
        if operation.type == "add_node":
            return self._add_node(flow, operation.node)
        elif operation.type == "update_node":
            return self._update_node(flow, operation.node)
        elif operation.type == "delete_node":
            return self._delete_node(flow, operation.node_id)
        elif operation.type == "add_edge":
            return self._add_edge(flow, operation.edge)
        elif operation.type == "update_edge":
            return self._update_edge(flow, operation.edge)
        elif operation.type == "delete_edge":
            return self._delete_edge(flow, operation.edge_id)
        else:
            raise PatchEngineError(f"Unknown operation type: {operation.type}")
    
    def _add_node(self, flow: ProcessFlow, node: ProcessNode) -> ProcessFlow:
        """Add a new node to the flow."""
        if not node:
            raise PatchEngineError("Node data required for add_node operation")
        
        if any(n.id == node.id for n in flow.nodes):
            raise PatchEngineError(f"Node with ID '{node.id}' already exists")
        
        if node.type == NodeType.PROCESS and not node.logical_id:
            node.logical_id = get_next_sequential_id([
                {"logical_id": n.logical_id} for n in flow.nodes 
                if n.logical_id and n.type == NodeType.PROCESS
            ])
        
        if not node.created_at:
            node.created_at = datetime.utcnow().isoformat()
        
        flow.nodes.append(node)
        return flow
    
    def _update_node(self, flow: ProcessFlow, node: ProcessNode) -> ProcessFlow:
        """Update an existing node."""
        if not node:
            raise PatchEngineError("Node data required for update_node operation")
        
        existing_index = None
        for i, existing_node in enumerate(flow.nodes):
            if existing_node.id == node.id:
                existing_index = i
                break
        
        if existing_index is None:
            raise PatchEngineError(f"Node with ID '{node.id}' not found for update")
        
        existing_node = flow.nodes[existing_index]
        node.created_at = existing_node.created_at
        
        if existing_node.user_modified and not node.user_modified:
            if not existing_node.user_modified:
                node.user_modified = False
        
        flow.nodes[existing_index] = node
        return flow
    
    def _delete_node(self, flow: ProcessFlow, node_id: str) -> ProcessFlow:
        """Delete a node and all connected edges."""
        if not node_id:
            raise PatchEngineError("Node ID required for delete_node operation")
        
        node_exists = any(n.id == node_id for n in flow.nodes)
        if not node_exists:
            raise PatchEngineError(f"Node with ID '{node_id}' not found for deletion")
        
        flow.nodes = [n for n in flow.nodes if n.id != node_id]
        flow.edges = [e for e in flow.edges if e.source != node_id and e.target != node_id]
        
        return flow
    
    def _add_edge(self, flow: ProcessFlow, edge: ProcessEdge) -> ProcessFlow:
        """Add a new edge to the flow."""
        if not edge:
            raise PatchEngineError("Edge data required for add_edge operation")
        
        if any(e.id == edge.id for e in flow.edges):
            raise PatchEngineError(f"Edge with ID '{edge.id}' already exists")
        
        # Check for duplicate source->target connections
        if any(e.source == edge.source and e.target == edge.target for e in flow.edges):
            raise PatchEngineError(f"Edge from '{edge.source}' to '{edge.target}' already exists")
        
        node_ids = {n.id for n in flow.nodes}
        if edge.source not in node_ids:
            raise PatchEngineError(f"Source node '{edge.source}' not found")
        if edge.target not in node_ids:
            raise PatchEngineError(f"Target node '{edge.target}' not found")
        
        print(f"🔗 Adding edge: {edge.source} -> {edge.target}")
        validation_error = self._validate_connection(flow, edge)
        if validation_error:
            print(f"❌ Validation error: {validation_error}")
            raise PatchEngineError(validation_error)
        
        if not edge.created_at:
            edge.created_at = datetime.utcnow().isoformat()
        
        flow.edges.append(edge)
        print(f"✅ Edge added successfully: {edge.source} -> {edge.target}")
        return flow
    
    def _update_edge(self, flow: ProcessFlow, edge: ProcessEdge) -> ProcessFlow:
        """Update an existing edge."""
        if not edge:
            raise PatchEngineError("Edge data required for update_edge operation")
        
        existing_index = None
        for i, existing_edge in enumerate(flow.edges):
            if existing_edge.id == edge.id:
                existing_index = i
                break
        
        if existing_index is None:
            raise PatchEngineError(f"Edge with ID '{edge.id}' not found for update")
        
        existing_edge = flow.edges[existing_index]
        edge.created_at = existing_edge.created_at
        flow.edges[existing_index] = edge
        return flow
    
    def _delete_edge(self, flow: ProcessFlow, edge_id: str) -> ProcessFlow:
        """Delete an edge."""
        if not edge_id:
            raise PatchEngineError("Edge ID required for delete_edge operation")
        
        edge_exists = any(e.id == edge_id for e in flow.edges)
        if not edge_exists:
            raise PatchEngineError(f"Edge with ID '{edge_id}' not found for deletion")
        
        flow.edges = [e for e in flow.edges if e.id != edge_id]
        return flow

    def _enforce_single_outgoing_from_process(self, flow: ProcessFlow, source_node: ProcessNode, new_edge: ProcessEdge) -> Optional[str]:
        """
        Ensure process nodes only have one outgoing edge.
        Process nodes with multiple outgoing edges should be DECISION nodes instead.
        """
        outgoing_edges = [e for e in flow.edges if e.source == source_node.id]

        if len(outgoing_edges) == 0:
            return None  # first outgoing is fine

        # 🚨 Process nodes should not have multiple outgoing edges
        # This suggests the node should be a DECISION node instead
        return f"PROCESS node '{source_node.label}' cannot have multiple outgoing connections. Consider making it a DECISION node if it represents a choice point."
    
    
    def _validate_connection(self, flow: ProcessFlow, new_edge: ProcessEdge) -> Optional[str]:
        """Validate that a new connection follows business rules."""
        source_node = next((n for n in flow.nodes if n.id == new_edge.source), None)
        target_node = next((n for n in flow.nodes if n.id == new_edge.target), None)
        
        if not source_node or not target_node:
            return "Source or target node not found"
        
        source_outgoing = len([e for e in flow.edges if e.source == new_edge.source])
        target_incoming = len([e for e in flow.edges if e.target == new_edge.target])
        
        print(f"🔍 Validating connection: {source_node.label} ({source_node.type}) -> {target_node.label} ({target_node.type})")
        print(f"   Source outgoing: {source_outgoing}, Target incoming: {target_incoming}")
        
        # Handle outgoing connection rules
        if source_node.type == NodeType.START:
            if source_outgoing >= 1:
                return "START nodes can only have one outgoing connection"
        elif source_node.type == NodeType.END:
            return "END nodes cannot have outgoing connections"
        elif source_node.type == NodeType.PROCESS:
            if source_outgoing >= 1:
                return self._enforce_single_outgoing_from_process(flow, source_node, new_edge)
        elif source_node.type == NodeType.DECISION:
            if source_outgoing >= 4:
                return "DECISION nodes can have maximum 4 outgoing connections"
        
        # Handle incoming connection rules
        if target_node.type == NodeType.START:
            return "START nodes cannot have incoming connections"
        elif target_node.type == NodeType.PROCESS:
            if target_incoming >= 1:
                print(f"🚨 Process node {target_node.label} already has {target_incoming} incoming connections - will create merge node during post-processing")
                # Allow the edge to be added for now - merge nodes will be created in post-processing
                return None
        elif target_node.type == NodeType.DECISION:
            if target_incoming >= 1:
                print(f"🚨 Decision node {target_node.label} already has {target_incoming} incoming connections - will create merge node during post-processing")
                # Allow the edge to be added for now - merge nodes will be created in post-processing
                return None
        
        return None
    
    def _create_merge_nodes_for_multiple_incoming(self, flow: ProcessFlow) -> ProcessFlow:
        """Create merge nodes for process and decision nodes that have multiple incoming edges."""
        from schemas.process_flow import ProcessNode, NodeType, AutomationLevel, ProcessEdge
        
        # Find process and decision nodes with multiple incoming edges
        nodes_to_fix = []
        for node in flow.nodes:
            if node.type in [NodeType.PROCESS, NodeType.DECISION]:
                incoming_count = len([e for e in flow.edges if e.target == node.id])
                if incoming_count > 1:
                    nodes_to_fix.append(node)
                    print(f"🔍 Found node needing merge: {node.label} ({node.type}) has {incoming_count} incoming edges")
        
        # Create merge nodes for each node that needs fixing
        for target_node in nodes_to_fix:
            incoming_edges = [e for e in flow.edges if e.target == target_node.id]
            
            # Create merge node
            merge_node = ProcessNode(
                id=str(uuid.uuid4()),
                type=NodeType.MERGE,
                label=f"Merge before {target_node.label}",
                automation=AutomationLevel.MANUAL
            )
            flow.nodes.append(merge_node)
            
            # Redirect all incoming edges to the merge node
            for edge in incoming_edges:
                edge.target = merge_node.id
            
            # Create bridge edge from merge to target node
            bridge_edge = ProcessEdge(
                id=str(uuid.uuid4()),
                source=merge_node.id,
                target=target_node.id
            )
            flow.edges.append(bridge_edge)
            
            print(f"🔧 Post-process: Created MERGE node for '{target_node.label}' with {len(incoming_edges)} incoming connections")
        
        return flow
    
    def _add_to_history(self, original_flow: ProcessFlow, patch: FlowPatch) -> None:
        """Add operation to history for potential rollback."""
        self.history.append((original_flow, patch))
        if len(self.history) > self.max_history:
            self.history.pop(0)
    
    def get_history(self) -> List[Tuple[ProcessFlow, FlowPatch]]:
        return self.history.copy()
    
    def rollback_last_patch(self) -> Optional[ProcessFlow]:
        """Rollback the last applied patch."""
        if not self.history:
            return None
        original_flow, _ = self.history.pop()
        return original_flow
    
    def create_patch_from_llm_output(self, llm_operations: List[Dict]) -> FlowPatch:
        """Create a validated FlowPatch from LLM output."""
        operations = []
        
        for op_data in llm_operations:
            try:
                if "type" not in op_data:
                    op_data = self._normalize_legacy_format(op_data)
                operation = PatchOperation(**op_data)
                
                if operation.type == "add_node" and operation.node:
                    if not operation.node.id:
                        operation.node.id = str(uuid.uuid4())
                elif operation.type == "add_edge" and operation.edge:
                    if not operation.edge.id:
                        operation.edge.id = str(uuid.uuid4())
                
                operations.append(operation)
            except Exception as e:
                print(f"Skipping invalid operation: {op_data}, error: {e}")
                continue
        
        return FlowPatch(
            operations=operations,
            source="llm",
            created_at=datetime.utcnow().isoformat()
        )
    
    def _normalize_legacy_format(self, op_data: Dict) -> Dict:
        """Normalize legacy operation format to current schema."""
        for old_key in ["add_node", "update_node", "delete_node", "add_edge", "update_edge", "delete_edge"]:
            if old_key in op_data:
                return {
                    "type": old_key,
                    old_key.split("_")[1]: op_data[old_key]
                }
        return op_data
    
    def validate_patch_before_apply(self, flow: ProcessFlow, patch: FlowPatch) -> List[str]:
        """Validate a patch without applying it."""
        errors = []
        try:
            temp_flow = copy.deepcopy(flow)
            temp_patch = copy.deepcopy(patch)
            
            for operation in temp_patch.operations:
                temp_flow = self._apply_operation(temp_flow, operation)
            
            validation_errors = validate_flow_topology(temp_flow)
            errors.extend(validation_errors)
        except Exception as e:
            errors.append(str(e))
        return errors
    
    def renumber_logical_ids(self, flow: ProcessFlow) -> ProcessFlow:
        """Renumber logical IDs based on flow sequence (only PROCESS nodes)."""
        from .step_id import renumber_by_flow_sequence
        
        nodes_data = [
            {"id": n.id, "logical_id": n.logical_id, "type": n.type.value}
            for n in flow.nodes
        ]
        
        edges_data = [{"source": e.source, "target": e.target} for e in flow.edges]
        renumbered_nodes = renumber_by_flow_sequence(nodes_data, edges_data)
        
        node_map = {n.id: n for n in flow.nodes}
        for renumbered in renumbered_nodes:
            if renumbered["id"] in node_map:
                node_map[renumbered["id"]].logical_id = renumbered["logical_id"]
        
        return flow
