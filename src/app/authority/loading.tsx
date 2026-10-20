import { PortalLoading } from "@/components/portal-loading";
import { AUTHORITY_NAV } from "./nav";

export default function Loading() {
  return <PortalLoading portalName="Authority portal" nav={AUTHORITY_NAV} />;
}
