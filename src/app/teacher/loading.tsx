import { PortalLoading } from "@/components/portal-loading";
import { TEACHER_NAV } from "./nav";

export default function Loading() {
  return <PortalLoading portalName="Teacher portal" nav={TEACHER_NAV} />;
}
