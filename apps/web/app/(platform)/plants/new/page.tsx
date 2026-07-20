import { createPlant } from "../actions";

const inputClassName =
  "mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-blue-500";

export default function NewPlantPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <p className="text-white/60">
          Add a photovoltaic plant to your organization.
        </p>
      </div>

      <form action={createPlant} className="space-y-8">
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium">General</h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label>
              <span className="text-sm text-white/60">Name</span>
              <input
                name="name"
                required
                className={inputClassName}
                placeholder="Solar Park Sofia"
              />
            </label>

            <label>
              <span className="text-sm text-white/60">Vendor</span>
              <input
                name="vendor"
                defaultValue="Huawei"
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">Timezone</span>
              <input
                name="timezone"
                defaultValue="Europe/Sofia"
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
                className={inputClassName}
                placeholder="1000"
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
                className={inputClassName}
                placeholder="Huawei station code"
              />
            </label>

            <label>
              <span className="text-sm text-white/60">Plant Code</span>
              <input
                name="plantCode"
                className={inputClassName}
                placeholder="Internal or vendor plant code"
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
                className={inputClassName}
                placeholder="Bulgaria"
              />
            </label>

            <label>
              <span className="text-sm text-white/60">City</span>
              <input
                name="city"
                className={inputClassName}
                placeholder="Sofia"
              />
            </label>

            <label className="md:col-span-2">
              <span className="text-sm text-white/60">Address</span>
              <input
                name="address"
                className={inputClassName}
                placeholder="Plant address"
              />
            </label>

            <label>
              <span className="text-sm text-white/60">Latitude</span>
              <input
                name="latitude"
                type="number"
                step="0.000001"
                className={inputClassName}
                placeholder="42.697708"
              />
            </label>

            <label>
              <span className="text-sm text-white/60">Longitude</span>
              <input
                name="longitude"
                type="number"
                step="0.000001"
                className={inputClassName}
                placeholder="23.321868"
              />
            </label>
          </div>
        </section>

        <button
          type="submit"
          className="rounded-xl bg-blue-600 px-5 py-3 font-medium transition hover:bg-blue-500"
        >
          Create Plant
        </button>
      </form>
    </div>
  );
}
