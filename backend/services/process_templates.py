"""
Process Templates Service
Provides standard templates for L0-L2 processes that users can select and customize
"""

from typing import Dict, List, Any
from dataclasses import dataclass
from enum import Enum

class TemplateCategory(str, Enum):
    BUSINESS = "business"
    MANUFACTURING = "manufacturing"
    HEALTHCARE = "healthcare"
    EDUCATION = "education"
    TECHNOLOGY = "technology"
    FINANCE = "finance"
    RETAIL = "retail"
    GOVERNMENT = "government"

@dataclass
class ProcessTemplate:
    id: str
    name: str
    description: str
    level: int
    category: TemplateCategory
    template_data: Dict[str, Any]
    parent_template_id: str = None
    children_template_ids: List[str] = None

class ProcessTemplatesService:
    """Service for managing process templates"""
    
    def __init__(self):
        self.templates = self._load_templates()
    
    def _load_templates(self) -> Dict[str, ProcessTemplate]:
        """Load all available process templates"""
        templates = {}
        
        # L0 Templates (Organizations)
        templates.update(self._get_l0_templates())
        
        # L1 Templates (Departments)
        templates.update(self._get_l1_templates())
        
        # L2 Templates (Functions)
        templates.update(self._get_l2_templates())
        
        return templates
    
    def _get_l0_templates(self) -> Dict[str, ProcessTemplate]:
        """L0 Organization templates"""
        return {
            "tech_company": ProcessTemplate(
                id="tech_company",
                name="Technology Company",
                description="Standard structure for a technology company",
                level=0,
                category=TemplateCategory.TECHNOLOGY,
                template_data={
                    "departments": [
                        {"name": "Engineering", "code": "ENG", "description": "Software development and technical operations"},
                        {"name": "Product Management", "code": "PM", "description": "Product strategy and roadmap management"},
                        {"name": "Sales & Marketing", "code": "SM", "description": "Customer acquisition and brand management"},
                        {"name": "Human Resources", "code": "HR", "description": "Talent acquisition and employee management"},
                        {"name": "Finance & Operations", "code": "FO", "description": "Financial management and business operations"},
                        {"name": "Customer Success", "code": "CS", "description": "Customer support and success management"}
                    ]
                },
                children_template_ids=["tech_eng", "tech_pm", "tech_sm", "tech_hr", "tech_fo", "tech_cs"]
            ),
            
            "manufacturing_company": ProcessTemplate(
                id="manufacturing_company",
                name="Manufacturing Company",
                description="Standard structure for a manufacturing company",
                level=0,
                category=TemplateCategory.MANUFACTURING,
                template_data={
                    "departments": [
                        {"name": "Production", "code": "PROD", "description": "Manufacturing and production operations"},
                        {"name": "Quality Assurance", "code": "QA", "description": "Quality control and testing"},
                        {"name": "Supply Chain", "code": "SC", "description": "Procurement and logistics management"},
                        {"name": "Engineering", "code": "ENG", "description": "Product design and process engineering"},
                        {"name": "Sales & Marketing", "code": "SM", "description": "Customer relations and market development"},
                        {"name": "Human Resources", "code": "HR", "description": "Workforce management and development"}
                    ]
                },
                children_template_ids=["mfg_prod", "mfg_qa", "mfg_sc", "mfg_eng", "mfg_sm", "mfg_hr"]
            ),
            
            "healthcare_organization": ProcessTemplate(
                id="healthcare_organization",
                name="Healthcare Organization",
                description="Standard structure for a healthcare organization",
                level=0,
                category=TemplateCategory.HEALTHCARE,
                template_data={
                    "departments": [
                        {"name": "Clinical Services", "code": "CLIN", "description": "Patient care and clinical operations"},
                        {"name": "Administration", "code": "ADMIN", "description": "Administrative and support services"},
                        {"name": "Medical Records", "code": "MR", "description": "Patient data and records management"},
                        {"name": "Finance", "code": "FIN", "description": "Financial management and billing"},
                        {"name": "Human Resources", "code": "HR", "description": "Staff management and development"},
                        {"name": "IT Services", "code": "IT", "description": "Technology and systems support"}
                    ]
                },
                children_template_ids=["hc_clin", "hc_admin", "hc_mr", "hc_fin", "hc_hr", "hc_it"]
            ),
            
            "retail_company": ProcessTemplate(
                id="retail_company",
                name="Retail Company",
                description="Standard structure for a retail company",
                level=0,
                category=TemplateCategory.RETAIL,
                template_data={
                    "departments": [
                        {"name": "Merchandising", "code": "MERCH", "description": "Product selection and inventory management"},
                        {"name": "Store Operations", "code": "OPS", "description": "Store management and operations"},
                        {"name": "E-commerce", "code": "ECOM", "description": "Online sales and digital operations"},
                        {"name": "Marketing", "code": "MKT", "description": "Brand promotion and customer acquisition"},
                        {"name": "Supply Chain", "code": "SC", "description": "Logistics and distribution"},
                        {"name": "Finance", "code": "FIN", "description": "Financial management and reporting"}
                    ]
                },
                children_template_ids=["ret_merch", "ret_ops", "ret_ecom", "ret_mkt", "ret_sc", "ret_fin"]
            )
        }
    
    def _get_l1_templates(self) -> Dict[str, ProcessTemplate]:
        """L1 Department templates"""
        return {
            "tech_eng": ProcessTemplate(
                id="tech_eng",
                name="Engineering Department",
                description="Standard engineering department structure",
                level=1,
                category=TemplateCategory.TECHNOLOGY,
                parent_template_id="tech_company",
                template_data={
                    "functions": [
                        {"name": "Frontend Development", "code": "FE", "description": "User interface and client-side development"},
                        {"name": "Backend Development", "code": "BE", "description": "Server-side and API development"},
                        {"name": "DevOps", "code": "DO", "description": "Infrastructure and deployment automation"},
                        {"name": "Quality Assurance", "code": "QA", "description": "Testing and quality assurance"},
                        {"name": "Data Engineering", "code": "DE", "description": "Data pipeline and analytics infrastructure"},
                        {"name": "Security", "code": "SEC", "description": "Cybersecurity and compliance"}
                    ]
                },
                children_template_ids=["eng_fe", "eng_be", "eng_do", "eng_qa", "eng_de", "eng_sec"]
            ),
            
            "tech_hr": ProcessTemplate(
                id="tech_hr",
                name="Human Resources Department",
                description="Standard HR department structure",
                level=1,
                category=TemplateCategory.TECHNOLOGY,
                parent_template_id="tech_company",
                template_data={
                    "functions": [
                        {"name": "Recruitment", "code": "REC", "description": "Talent acquisition and hiring"},
                        {"name": "Employee Relations", "code": "ER", "description": "Employee engagement and relations"},
                        {"name": "Learning & Development", "code": "L&D", "description": "Training and professional development"},
                        {"name": "Compensation & Benefits", "code": "C&B", "description": "Pay and benefits management"},
                        {"name": "HR Operations", "code": "OPS", "description": "HR systems and administrative processes"}
                    ]
                },
                children_template_ids=["hr_rec", "hr_er", "hr_ld", "hr_cb", "hr_ops"]
            ),
            
            "mfg_prod": ProcessTemplate(
                id="mfg_prod",
                name="Production Department",
                description="Standard manufacturing production department",
                level=1,
                category=TemplateCategory.MANUFACTURING,
                parent_template_id="manufacturing_company",
                template_data={
                    "functions": [
                        {"name": "Assembly", "code": "ASSY", "description": "Product assembly operations"},
                        {"name": "Machining", "code": "MACH", "description": "Precision machining operations"},
                        {"name": "Packaging", "code": "PKG", "description": "Product packaging and labeling"},
                        {"name": "Maintenance", "code": "MAINT", "description": "Equipment maintenance and repair"},
                        {"name": "Production Planning", "code": "PLAN", "description": "Production scheduling and planning"}
                    ]
                },
                children_template_ids=["prod_assy", "prod_mach", "prod_pkg", "prod_maint", "prod_plan"]
            ),
            
            "hc_clin": ProcessTemplate(
                id="hc_clin",
                name="Clinical Services Department",
                description="Standard clinical services department",
                level=1,
                category=TemplateCategory.HEALTHCARE,
                parent_template_id="healthcare_organization",
                template_data={
                    "functions": [
                        {"name": "Emergency Services", "code": "ER", "description": "Emergency care and trauma services"},
                        {"name": "Surgery", "code": "SURG", "description": "Surgical procedures and operations"},
                        {"name": "Outpatient Care", "code": "OUT", "description": "Outpatient consultation and treatment"},
                        {"name": "Diagnostic Services", "code": "DIAG", "description": "Medical testing and diagnostics"},
                        {"name": "Nursing", "code": "NURS", "description": "Patient care and nursing services"}
                    ]
                },
                children_template_ids=["clin_er", "clin_surg", "clin_out", "clin_diag", "clin_nurs"]
            )
        }
    
    def _get_l2_templates(self) -> Dict[str, ProcessTemplate]:
        """L2 Function templates"""
        return {
            "eng_fe": ProcessTemplate(
                id="eng_fe",
                name="Frontend Development",
                description="Frontend development function with common processes",
                level=2,
                category=TemplateCategory.TECHNOLOGY,
                parent_template_id="tech_eng",
                template_data={
                    "processes": [
                        {"name": "Feature Development", "code": "FEAT", "description": "New feature development process"},
                        {"name": "Bug Fixing", "code": "BUG", "description": "Bug identification and resolution process"},
                        {"name": "Code Review", "code": "REV", "description": "Code review and quality assurance process"},
                        {"name": "UI/UX Implementation", "code": "UI", "description": "User interface implementation process"},
                        {"name": "Performance Optimization", "code": "PERF", "description": "Frontend performance optimization process"}
                    ]
                }
            ),
            
            "eng_be": ProcessTemplate(
                id="eng_be",
                name="Backend Development",
                description="Backend development function with common processes",
                level=2,
                category=TemplateCategory.TECHNOLOGY,
                parent_template_id="tech_eng",
                template_data={
                    "processes": [
                        {"name": "API Development", "code": "API", "description": "REST API development process"},
                        {"name": "Database Design", "code": "DB", "description": "Database schema and optimization process"},
                        {"name": "Microservices Development", "code": "MS", "description": "Microservices architecture implementation"},
                        {"name": "Integration Testing", "code": "INT", "description": "System integration testing process"},
                        {"name": "Performance Monitoring", "code": "MON", "description": "Backend performance monitoring process"}
                    ]
                }
            ),
            
            "hr_rec": ProcessTemplate(
                id="hr_rec",
                name="Recruitment",
                description="Recruitment function with standard hiring processes",
                level=2,
                category=TemplateCategory.TECHNOLOGY,
                parent_template_id="tech_hr",
                template_data={
                    "processes": [
                        {"name": "Job Posting", "code": "POST", "description": "Job posting and advertisement process"},
                        {"name": "Candidate Screening", "code": "SCREEN", "description": "Initial candidate screening process"},
                        {"name": "Interview Process", "code": "INT", "description": "Interview scheduling and execution process"},
                        {"name": "Reference Checks", "code": "REF", "description": "Reference verification process"},
                        {"name": "Offer Management", "code": "OFFER", "description": "Job offer creation and negotiation process"}
                    ]
                }
            ),
            
            "prod_assy": ProcessTemplate(
                id="prod_assy",
                name="Assembly Operations",
                description="Assembly operations function with manufacturing processes",
                level=2,
                category=TemplateCategory.MANUFACTURING,
                parent_template_id="mfg_prod",
                template_data={
                    "processes": [
                        {"name": "Assembly Line Setup", "code": "SETUP", "description": "Assembly line preparation and setup process"},
                        {"name": "Component Assembly", "code": "COMP", "description": "Component assembly and integration process"},
                        {"name": "Quality Inspection", "code": "QI", "description": "Assembly quality inspection process"},
                        {"name": "Packaging Preparation", "code": "PKG", "description": "Product packaging preparation process"},
                        {"name": "Line Maintenance", "code": "MAINT", "description": "Assembly line maintenance process"}
                    ]
                }
            )
        }
    
    def get_templates_by_level(self, level: int) -> List[ProcessTemplate]:
        """Get all templates for a specific level"""
        return [template for template in self.templates.values() if template.level == level]
    
    def get_templates_by_category(self, category: TemplateCategory) -> List[ProcessTemplate]:
        """Get all templates for a specific category"""
        return [template for template in self.templates.values() if template.category == category]
    
    def get_template(self, template_id: str) -> ProcessTemplate:
        """Get a specific template by ID"""
        return self.templates.get(template_id)
    
    def get_child_templates(self, parent_template_id: str) -> List[ProcessTemplate]:
        """Get child templates for a parent template"""
        parent_template = self.get_template(parent_template_id)
        if not parent_template or not parent_template.children_template_ids:
            return []
        
        return [self.get_template(child_id) for child_id in parent_template.children_template_ids if self.get_template(child_id)]
    
    def get_all_categories(self) -> List[TemplateCategory]:
        """Get all available template categories"""
        return list(TemplateCategory)
    
    def search_templates(self, query: str, level: int = None, category: TemplateCategory = None) -> List[ProcessTemplate]:
        """Search templates by name or description"""
        results = []
        query_lower = query.lower()
        
        for template in self.templates.values():
            if level is not None and template.level != level:
                continue
            if category is not None and template.category != category:
                continue
            
            if (query_lower in template.name.lower() or 
                query_lower in template.description.lower()):
                results.append(template)
        
        return results
