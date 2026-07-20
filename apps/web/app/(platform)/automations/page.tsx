import { HuaweiControlCard } from "@/components/automations/HuaweiControlCard";

export { pageHeading } from "./heading";

export default function AutomationsPage() {
  return (
    <div>
      <HuaweiControlCard />

      <section className="mt-8">
        <p className="text-white/60">
          Configure plant control strategies and automation rules.
        </p>
      </section>
    </div>
  );
}
