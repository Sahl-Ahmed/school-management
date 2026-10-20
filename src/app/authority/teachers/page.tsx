import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { fingerEnrollmentWarning } from "@/lib/validation/teacher";
import { Banner } from "@/components/form";
import {
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  NavButton,
  PageHeader,
  PageSections,
  Status,
  Td,
  Th,
  Tr,
} from "@/components/ui";

export const metadata: Metadata = { title: "Teachers" };
export const dynamic = "force-dynamic";

export default async function TeachersPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  const { data: teachers, error } = await supabase
    .from("teachers")
    .select(
      `
      id, employee_code, full_name, designation, is_active, auth_user_id,
      device_users(device_user_id, enrolled_fingers, is_active),
      teacher_assignments(id)
    `,
    )
    .eq("is_active", true)
    .order("full_name");

  const rows = teachers ?? [];
  const withoutAccount = rows.filter((t) => !t.auth_user_id).length;

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <PageSections>
        <PageHeader
          title="Teachers"
          meta={
            <>
              {rows.length} active
              {withoutAccount > 0 &&
                ` · ${withoutAccount} without a sign-in yet`}
            </>
          }
          actions={
            <NavButton href="/authority/teachers/new" tone="primary" icon="teachers">
              Add a teacher
            </NavButton>
          }
        />

        {error ? (
          <Banner tone="error">Could not load teachers: {error.message}</Banner>
        ) : (
          <Card padded={false}>
            <CardHeader
              title="Active teachers"
              hint="A teacher's assignments decide which classes, students and marks they can reach, and are set through the class routine."
            />

            {rows.length === 0 ? (
              <EmptyState
                icon="teachers"
                title="No teachers yet"
                action={
                  <NavButton href="/authority/teachers/new" tone="primary" icon="teachers">
                    Add the first teacher
                  </NavButton>
                }
              >
                Adding a teacher creates their record and, optionally, their
                sign-in. Until a teacher exists, the routine has nobody to
                assign a lesson to.
              </EmptyState>
            ) : (
              <DataTable
                caption="Active teachers, their assignments and sign-in state"
                head={
                  <>
                    <Th>Name</Th>
                    <Th>Employee code</Th>
                    <Th align="right">Assignments</Th>
                    <Th>Sign-in</Th>
                    <Th>Fingerprint terminal</Th>
                  </>
                }
              >
                {rows.map((t) => {
                  const mapping = (t.device_users ?? []).find((d) => d.is_active);
                  const warning = mapping
                    ? fingerEnrollmentWarning(mapping.enrolled_fingers)
                    : null;
                  const assignmentCount = (t.teacher_assignments ?? []).length;

                  return (
                    <Tr key={t.id}>
                      <Td>
                        <span className="block font-medium">{t.full_name}</span>
                        {t.designation && (
                          <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                            {t.designation}
                          </span>
                        )}
                      </Td>
                      <Td numeric align="left">
                        {t.employee_code}
                      </Td>
                      <Td numeric>
                        {assignmentCount === 0 ? (
                          <span style={{ color: "var(--state-warn)" }}>0</span>
                        ) : (
                          assignmentCount
                        )}
                      </Td>
                      <Td>
                        {t.auth_user_id ? (
                          <Status tone="good">created</Status>
                        ) : (
                          <Status tone="warn">none yet</Status>
                        )}
                      </Td>
                      <Td>
                        {mapping ? (
                          <>
                            <span className="numeric block text-xs">
                              ID {mapping.device_user_id} · {mapping.enrolled_fingers} finger
                              {mapping.enrolled_fingers === 1 ? "" : "s"}
                            </span>
                            {warning && (
                              <span
                                className="mt-1 block text-xs"
                                style={{ color: "var(--state-warn)" }}
                              >
                                {warning}
                              </span>
                            )}
                          </>
                        ) : (
                          /* The terminal itself is not bought yet, so "not
                             mapped" is the expected state, not a fault. */
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                            not mapped
                          </span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </DataTable>
            )}
          </Card>
        )}

        <Card>
          <h2 className="text-sm font-semibold">About the fingerprint terminal</h2>
          <p
            className="mt-1.5 text-sm leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            The K40 terminal has not been bought, so no teacher is expected to
            have a mapping yet. The columns above are ready for it: when a device
            arrives, mapping a teacher to a terminal ID is all that is needed.
          </p>
        </Card>
      </PageSections>
    </PortalShell>
  );
}
