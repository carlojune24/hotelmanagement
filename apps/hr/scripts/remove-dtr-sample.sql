-- Removes the sample data left by: KEEP_SAMPLE=1 pnpm vitest run src/lib/server/hr/dtr-sample.test.ts
-- Scope: establishments whose slug starts "dtr-sample-", the "DS<n>-" test staff assigned to them, and the
-- two "Sample ... leave" types the sample created.
-- Run: psql "$DATABASE_URL" -f scripts/remove-dtr-sample.sql
begin;
create temp table t_est as select id from establishments where slug like 'dtr-sample-%';
create temp table t_emp as select distinct employee_id id from employee_assignments where establishment_id in (select id from t_est)
  and employee_id in (select id from employees where employee_no ~ '^DS[0-9]-' and last_name = 'Test');
delete from employees where id in (select id from t_emp);
delete from establishments where id in (select id from t_est);
delete from leave_types where name in ('Sample paid leave', 'Sample unpaid leave');
commit;
