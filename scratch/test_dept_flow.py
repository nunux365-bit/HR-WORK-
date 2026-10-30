from backend.server import create_app
import json

app = create_app()
client = app.test_client()

print("--- 1. Testing Department Creation by Admin ---")
payload = {
    "team_name": "Legal & Compliance Desk",
    "dept_code": "DEPT-LEGAL",
    "dept_gmail": "legal.desk.hr@gmail.com",
    "category_scope": "LEGAL, COMPLIANCE",
    "sla_hours": 72,
    "default_priority": "HIGH",
    "description": "Handles employment law, NDAs, contract reviews, and statutory compliance.",
    "lead_name": "Ananya Roy",
    "lead_email": "ananya.roy@company.com",
    "keywords_strong": "legal notice, nda review, non-disclosure, employment contract, compliance audit",
    "keywords_weak": "legal, contract, agreement, compliance, statute, lawyer"
}

res = client.post(
    "/api/cases/departments",
    json=payload,
    headers={"X-HR-Role": "ADMIN", "X-HR-User": "Admin"}
)
print("Create Status:", res.status_code)
assert res.status_code == 201, f"Failed: {res.data}"
d_json = res.get_json()
created = d_json["data"]["department"]
dept_id = created["id"]
print(f"Created Department #{dept_id}: {created['team_name']} ({created['dept_code']})")

print("\n--- 2. Checking if Department is in Directory ---")
res_list = client.get("/api/cases/departments")
all_depts = res_list.get_json()["data"]["departments"]
dept_names = [d["team_name"] for d in all_depts]
print("All Departments count:", len(all_depts))
assert "Legal & Compliance Desk" in dept_names
print("Found 'Legal & Compliance Desk' in department directory!")

print("\n--- 3. Testing Adding a Specialist/Member to this Department ---")
member_payload = {
    "name": "Siddharth Verma",
    "email": "siddharth.legal@company.com",
    "role": "HR_AGENT",
    "designation": "Legal Compliance Specialist"
}
res_mem = client.post(
    f"/api/cases/departments/{dept_id}/members",
    json=member_payload,
    headers={"X-HR-Role": "ADMIN", "X-HR-User": "Admin"}
)
print("Add Member Status:", res_mem.status_code)
assert res_mem.status_code == 201
mem_data = res_mem.get_json()["data"]["member"]
mem_id = mem_data["id"]
print(f"Added Member #{mem_id}: {mem_data['member_name']} ({mem_data['designation']})")

print("\n--- 4. Testing Updating Department Settings ---")
update_payload = {
    "sla_hours": 48,
    "default_priority": "CRITICAL",
    "description": "Updated SLA and Critical priority for legal cases."
}
res_up = client.put(
    f"/api/cases/departments/{dept_id}",
    json=update_payload,
    headers={"X-HR-Role": "ADMIN", "X-HR-User": "Admin"}
)
print("Update Dept Status:", res_up.status_code)
assert res_up.status_code == 200
up_dept = res_up.get_json()["data"]["department"]
assert up_dept["sla_hours"] == 48
assert up_dept["default_priority"] == "CRITICAL"
print("Department successfully updated!")

print("\n--- 5. Checking User Management integration ---")
res_roster = client.get("/api/agent/employees")
roster_data = res_roster.get_json()["data"]
depts_in_um = [d["team_name"] for d in roster_data["departments"]]
assert "Legal & Compliance Desk" in depts_in_um
print("New department is dynamically available in User Management dropdowns!")

print("\n--- 6. Testing Department Deletion by Admin ---")
res_del = client.delete(
    f"/api/cases/departments/{dept_id}",
    headers={"X-HR-Role": "ADMIN", "X-HR-User": "Admin"}
)
print("Delete Dept Status:", res_del.status_code)
assert res_del.status_code == 200
depts_after_del = [d["team_name"] for d in res_del.get_json()["data"]["departments"]]
assert "Legal & Compliance Desk" not in depts_after_del
print("Department deleted and purged cleanly!")

print("\nALL ADMIN DEPARTMENT WORKFLOW CHECKS PASSED 100% OK!")

