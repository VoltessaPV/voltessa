import Link from "next/link";

import { createPlant } from "../actions";

export default function NewPlantPage() {
  return (
    <div>
      <h1>Create Plant</h1>

      <form action={createPlant}>
        <div>
          <label htmlFor="name">Plant name</label>

          <input
            id="name"
            name="name"
            type="text"
            required
          />
        </div>

        <div>
          <label htmlFor="vendor">Vendor</label>

          <select
            id="vendor"
            name="vendor"
            defaultValue="Huawei"
          >
            <option value="Huawei">Huawei</option>
          </select>
        </div>

        <div>
          <label htmlFor="timezone">Timezone</label>

          <select
            id="timezone"
            name="timezone"
            defaultValue="Europe/Sofia"
          >
            <option value="Europe/Sofia">
              Europe/Sofia
            </option>
          </select>
        </div>

        <button type="submit">
          Create Plant
        </button>
      </form>

      <Link href="/plants">
        Cancel
      </Link>
    </div>
  );
}