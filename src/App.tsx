import { Sidebar } from "./components/Sidebar";
import { ServicePanel } from "./components/ServicePanel";

export default function App() {
  return (
    <div class="h-full flex">
      <Sidebar />
      <ServicePanel />
    </div>
  );
}
