import { notFound } from "next/navigation";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { updatePlant } from "../../actions";

export { pageHeading } from "./heading";

const inputClassName =
  "mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-blue-500";

type EditPlantPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditPlantPage({ params }: EditPlantPageProps) {
  const user = await requirePermission(Permissions.canManagePlants);

  const { id } = await params;

  const plant = await prisma.plant.findFirst({
    where: {
      id,
      organizationId: user.organizationId,
    },
  });

  if (!plant) {
    notFound();
  }

  const updatePlantAction = updatePlant.bind(null, plant.id);

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <p className="text-white/60">Update plant information.</p>
      </div>

      <form action={updatePlantAction} className="space-y-8">
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium">General</h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label>
              <span className="text-sm text-white/60">Name</span>
              <input
                name="name"
                required
                defaultValue={plant.name}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">Vendor</span>
              <input
                name="vendor"
                defaultValue={plant.vendor}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">Timezone</span>
              <input
                name="timezone"
                defaultValue={plant.timezone}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">Capacity (kW)</span>
              <input
                name="capacityKw"
                type="number"
                min="0"
                step="0.01"
                defaultValue={plant.capacityKw?.toString() ?? ""}
                className={inputClassName}
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium">Vendor identifiers</h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label>
              <span className="text-sm text-white/60">Station Code</span>
              <input
                name="stationCode"
                defaultValue={plant.stationCode ?? ""}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">Plant Code</span>
              <input
                name="plantCode"
                defaultValue={plant.plantCode ?? ""}
                className={inputClassName}
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium">Location</h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label>
              <span className="text-sm text-white/60">Country</span>
              <input
                name="country"
                defaultValue={plant.country ?? ""}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">City</span>
              <input
                name="city"
                defaultValue={plant.city ?? ""}
                className={inputClassName}
              />
            </label>

            <label className="md:col-span-2">
              <span className="text-sm text-white/60">Address</span>
              <input
                name="address"
                defaultValue={plant.address ?? ""}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">Latitude</span>
              <input
                name="latitude"
                type="number"
                step="0.000001"
                defaultValue={plant.latitude?.toString() ?? ""}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">Longitude</span>
              <input
                name="longitude"
                type="number"
                step="0.000001"
                defaultValue={plant.longitude?.toString() ?? ""}
                className={inputClassName}
              />
            </label>
          </div>
        </section>

        <button
          type="submit"
          className="rounded-xl bg-blue-600 px-5 py-3 font-medium transition hover:bg-blue-500"
        >
          Save Changes
        </button>
      </form>
    </div>
  );
}
