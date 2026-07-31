import { selectTraderOrganization } from "@/app/[locale]/(platform)/actions";
import type { TraderClient } from "@/lib/trader/queries";

type Props = {
  clients: TraderClient[];
  redirectTo: string;
};

/** Table view - the Clients portfolio's default once a trader's list grows past `GRID_VIEW_MAX_CLIENTS` (see page.tsx). */
export function ClientTable({ clients, redirectTo }: Props) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/10 text-white/50">
          <tr>
            <th className="px-4 py-3 font-medium">Client</th>
            <th className="px-4 py-3 font-medium">Plants</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr key={client.organizationId} className="border-b border-white/5 last:border-0">
              <td className="px-4 py-3 text-white">{client.name}</td>
              <td className="px-4 py-3 text-white/70">{client.plantCount}</td>
              <td className="px-4 py-3">
                <span
                  className={
                    client.connected
                      ? "rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300"
                      : "rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/50"
                  }
                >
                  {client.connected ? "Connected" : "No plant"}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <form action={selectTraderOrganization}>
                  <input type="hidden" name="organizationId" value={client.organizationId} />
                  <input type="hidden" name="redirectTo" value={redirectTo} />
                  <button
                    type="submit"
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:border-white/20 hover:text-white"
                  >
                    View
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
