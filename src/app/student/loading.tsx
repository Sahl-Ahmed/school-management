import { PortalLoading } from "@/components/portal-loading";
import { STUDENT_NAV } from "./nav";

export default function Loading() {
  return <PortalLoading portalName="Student portal" nav={STUDENT_NAV} />;
}
