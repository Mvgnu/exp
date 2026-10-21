import { Workbench } from "../components/workbench";
import { demoSnapshot } from "../lib/demo";
export default function Page() {
  return <Workbench initialData={demoSnapshot} />;
}
