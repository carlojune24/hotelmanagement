-- Removes the mock data left by: KEEP_MOCK=1 pnpm vitest run src/lib/server/hr/scenarios.test.ts
-- Scope: establishments whose slug starts "scn-" and the "SC<n>-" test staff assigned to them.
-- Run: psql "$DATABASE_URL" -f scripts/remove-mock-data.sql
begin;
create temp table t_est as select id from establishments where slug like 'scn-%';
create temp table t_emp as select distinct employee_id id from employee_assignments where establishment_id in (select id from t_est)
  and employee_id in (select id from employees where employee_no ~ '^SC[0-9]-' and last_name = 'Test');
create temp table t_sep as select id from separations where employee_id in (select id from t_emp);
create temp table t_loan as select id from employee_loans where employee_id in (select id from t_emp);
delete from payroll_runs where id in (select run_id from payroll_batches where establishment_id in (select id from t_est));
delete from employee_loan_payments where loan_id in (select id from t_loan);
delete from separation_items where separation_id in (select id from t_sep);
delete from separation_clearance where separation_id in (select id from t_sep);
delete from separations where id in (select id from t_sep);
delete from employee_loans where id in (select id from t_loan);
delete from salary_history where employee_id in (select id from t_emp);
delete from employees where id in (select id from t_emp);
delete from loan_types where name like 'Scenario loan%';
delete from establishments where id in (select id from t_est);
commit;
