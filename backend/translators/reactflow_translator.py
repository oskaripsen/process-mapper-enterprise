"""
React Flow Translator

Converts canonical ProcessFlow to React Flow JSON format.
All positioning, styling, and UI-specific logic is handled here deterministically.
"""

from typing import Dict, List, Any, Tuple
import math
from schemas.process_flow import ProcessFlow, ProcessNode, ProcessEdge, NodeType

class ReactFlowTranslator:
    """
    Deterministic translator from ProcessFlow to React Flow format.
    Handles layout, styling, and UI-specific transformations.
    """
    
    def __init__(self):
        # Node styling configurations
        self.node_styles = {
            NodeType.START: {
                "width": 80,
                "height": 40,
                "borderRadius": "20px",
                "border": "2px solid #28a745",
                "background": "#ffffff",
                "color": "#333"
            },
            NodeType.END: {
                "width": 80,
                "height": 40,
                "borderRadius": "20px", 
                "border": "2px solid #dc3545",
                "background": "#ffffff",
                "color": "#333"
            },
            NodeType.PROCESS: {
                "width": 160,
                "height": 100,
                "borderRadius": "8px",
                "border": "2px solid #007bff",
                "background": "#ffffff",
                "color": "#333"
            },
            NodeType.DECISION: {
                "width": 100,
                "height": 100,
                "background": "transparent",
                "border": "none"
            },
            NodeType.MERGE: {
                "width": 60,
                "height": 60,
                "borderRadius": "50%",
                "border": "2px solid #007bff",
                "background": "#ffffff",
                "color": "#333"
            }
        }
        
        # Edge styling
        self.edge_style = {
            "strokeWidth": 2,
            "stroke": "#007bff"
        }
        
        self.marker_end = {
            "type": "ArrowClosed",
            "width": 20,
            "height": 20
        }
    
    def translate(self, flow: ProcessFlow, layout_algorithm: str = "hierarchical") -> Dict[str, Any]:
        """
        Convert ProcessFlow to React Flow format.
        
        Args:
            flow: Canonical process flow
            layout_algorithm: "hierarchical", "force", or "manual"
            
        Returns:
            Dict containing nodes and edges in React Flow format
        """
        # Convert nodes
        react_nodes = []
        for node in flow.nodes:
            react_node = self._convert_node(node)
            react_nodes.append(react_node)
        
        # Convert edges  
        react_edges = []
        for edge in flow.edges:
            react_edge = self._convert_edge(edge, flow.nodes)
            react_edges.append(react_edge)
        
        # Apply layout
        if layout_algorithm == "hierarchical":
            react_nodes = self._apply_hierarchical_layout(react_nodes, react_edges)
        elif layout_algorithm == "force":
            react_nodes = self._apply_force_layout(react_nodes, react_edges)
        # "manual" uses existing positions or defaults
        
        return {
            "nodes": react_nodes,
            "edges": react_edges,
            "metadata": {
                "flow_id": getattr(flow, 'id', 'generated'),
                "flow_name": getattr(flow, 'name', 'Process Flow'),
                "schema_version": getattr(flow, 'version', '1.0'),
                "layout_algorithm": layout_algorithm
            }
        }
    
    def _convert_node(self, node: ProcessNode) -> Dict[str, Any]:
        """Convert ProcessNode to React Flow node format"""
        
        # Determine React Flow node type
        rf_type = self._get_react_flow_type(node.type)
        
        # Base node structure
        react_node = {
            "id": node.id,
            "type": rf_type,
            "position": {"x": 0, "y": 0},  # Will be set by layout
            "data": {
                "label": node.label,
                "id": node.id,
                "logical_id": node.logical_id or "",
                "owner": node.owner or "TBD",
                "system": node.system or "TBD", 
                "manualOrAutomated": node.automation.value,
                "type": node.type.value,
                "user_modified": node.user_modified
            },
            "style": self.node_styles[node.type].copy()
        }
        
        return react_node
    
    def _convert_edge(self, edge: ProcessEdge, nodes: List[ProcessNode]) -> Dict[str, Any]:
        """Convert ProcessEdge to React Flow edge format"""
        
        # Find source node to determine if this edge needs a label
        source_node = next((n for n in nodes if n.id == edge.source), None)
        is_decision_edge = source_node and source_node.type == NodeType.DECISION
        
        react_edge = {
            "id": edge.id,
            "source": edge.source,
            "target": edge.target,
            "type": "step",
            "style": self.edge_style.copy(),
            "markerEnd": self.marker_end.copy()
        }
        
        # Add labels for decision edges
        if is_decision_edge and edge.condition:
            react_edge["label"] = edge.condition
            react_edge["labelStyle"] = {
                "fontSize": 12,
                "fontWeight": "bold", 
                "fill": "#333"
            }
            react_edge["labelBgStyle"] = {
                "fill": "#fff",
                "fillOpacity": 0.8,
                "stroke": "#333",
                "strokeWidth": 1,
                "rx": 4,
                "ry": 4
            }
        
        return react_edge
    
    def _get_react_flow_type(self, node_type: NodeType) -> str:
        """Map canonical node type to React Flow component type"""
        mapping = {
            NodeType.START: "start",
            NodeType.END: "end", 
            NodeType.PROCESS: "default",
            NodeType.DECISION: "decision",
            NodeType.MERGE: "merge"
        }
        return mapping[node_type]
    
    def _apply_hierarchical_layout(self, nodes: List[Dict], edges: List[Dict]) -> List[Dict]:
        """
        Apply hierarchical layout using level-based positioning.
        This is a simplified version - in production you'd use Dagre.
        """
        if not nodes:
            return nodes
            
        # Build adjacency graph
        adjacency = {}
        incoming = {}
        
        for edge in edges:
            source, target = edge["source"], edge["target"]
            
            if source not in adjacency:
                adjacency[source] = []
            adjacency[source].append(target)
            
            if target not in incoming:
                incoming[target] = []
            incoming[target].append(source)
        
        # Find start nodes (no incoming edges)
        start_nodes = []
        for node in nodes:
            if node["id"] not in incoming:
                start_nodes.append(node["id"])
        
        if not start_nodes:
            start_nodes = [nodes[0]["id"]]  # Fallback
        
        # Level assignment using BFS
        levels = {}
        queue = [(node_id, 0) for node_id in start_nodes]
        visited = set()
        
        while queue:
            node_id, level = queue.pop(0)
            if node_id in visited:
                continue
                
            visited.add(node_id)
            levels[node_id] = level
            
            # Add children to next level
            for child in adjacency.get(node_id, []):
                if child not in visited:
                    queue.append((child, level + 1))
        
        # Handle unvisited nodes
        for node in nodes:
            if node["id"] not in levels:
                levels[node["id"]] = 0
        
        # Position nodes by level
        level_groups = {}
        for node_id, level in levels.items():
            if level not in level_groups:
                level_groups[level] = []
            level_groups[level].append(node_id)
        
        # Apply positions (left-to-right layout)
        x_spacing = 200  # Horizontal spacing between levels
        y_spacing = 150  # Vertical spacing within levels
        
        positioned_nodes = []
        for node in nodes:
            node_id = node["id"]
            level = levels[node_id]
            level_nodes = level_groups[level]
            position_in_level = level_nodes.index(node_id)
            
            # Center nodes in each level vertically
            level_height = len(level_nodes) * y_spacing
            start_y = -level_height / 2
            
            # Left-to-right: x increases with level, y varies within level
            x = level * x_spacing
            y = start_y + (position_in_level * y_spacing) + y_spacing / 2
            
            positioned_node = node.copy()
            positioned_node["position"] = {"x": x, "y": y}
            positioned_nodes.append(positioned_node)
        
        return positioned_nodes
    
    def _apply_force_layout(self, nodes: List[Dict], edges: List[Dict]) -> List[Dict]:
        """
        Apply force-directed layout (simplified spring model).
        """
        if len(nodes) <= 1:
            return nodes
            
        # Initialize random positions
        import random
        positioned_nodes = []
        for i, node in enumerate(nodes):
            positioned_node = node.copy()
            positioned_node["position"] = {
                "x": random.uniform(-200, 200),
                "y": random.uniform(-200, 200)
            }
            positioned_nodes.append(positioned_node)
        
        # Simple force simulation (would use D3 force simulation in production)
        iterations = 50
        for _ in range(iterations):
            # Repulsion between all nodes
            for i, node1 in enumerate(positioned_nodes):
                for j, node2 in enumerate(positioned_nodes):
                    if i != j:
                        dx = node1["position"]["x"] - node2["position"]["x"]
                        dy = node1["position"]["y"] - node2["position"]["y"]
                        distance = math.sqrt(dx*dx + dy*dy)
                        if distance > 0:
                            force = 1000 / (distance * distance)
                            node1["position"]["x"] += (dx / distance) * force
                            node1["position"]["y"] += (dy / distance) * force
            
            # Attraction along edges
            for edge in edges:
                source_node = next(n for n in positioned_nodes if n["id"] == edge["source"])
                target_node = next(n for n in positioned_nodes if n["id"] == edge["target"])
                
                dx = target_node["position"]["x"] - source_node["position"]["x"]
                dy = target_node["position"]["y"] - source_node["position"]["y"]
                distance = math.sqrt(dx*dx + dy*dy)
                
                if distance > 0:
                    force = distance * 0.01
                    move_x = (dx / distance) * force
                    move_y = (dy / distance) * force
                    
                    source_node["position"]["x"] += move_x
                    source_node["position"]["y"] += move_y
                    target_node["position"]["x"] -= move_x
                    target_node["position"]["y"] -= move_y
        
        return positioned_nodes
