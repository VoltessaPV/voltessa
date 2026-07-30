import { selectTraderOrganization } from "@/app/(platform)/actions";
import Card from "@/components/ui/Card";
import type { TraderClient } from "@/lib/trader/queries";

type Props = {
  clients: TraderClient[];
  redirectTo: string;
};

/** Card/grid view - the Clients portfolio's default for smaller portfolios (see page.tsx's `GRID_VIEW_MAX_CLIENTS` threshold). */
export function ClientCardGrid({ clients, redirectTo }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {clients.map((client) => (
        <Card key={client.organizationId} className="flex flex-col justify-between p-5">
          <div>
            <h3 className="font-semibold text-white">{client.name}</h3>
            <p className="mt-1 text-xs text-white/50">
              {client.plantCount} {client.plantCount === 1 ? "plant" : "plants"}
            </p>
            <span
              className={
                client.connected
                  ? "mt-3 inline-block rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300"
                  : "mt-3 inline-block rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/50"
              }
            >
              {client.connected ? "Connected" : "No plant"}
            </span>
          </div>

          <form action={selectTraderOrganization} className="mt-5">
            <input type="hidden" name="organizationId" value={client.organizationId} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <button
              type="submit"
              className="w-full rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-white/80 transition hover:border-white/20 hover:text-white"
            >
              View
            </button>
          </form>
        </Card>
      ))}
    </div>
  );
}
