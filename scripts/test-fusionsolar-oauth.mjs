const clientId = process.env.FUSIONSOLAR_CLIENT_ID;
const redirectUri = process.env.FUSIONSOLAR_REDIRECT_URI;

const state = "voltessa-test";

const url = new URL(
  "https://oauth2.fusionsolar.huawei.com/rest/dp/uidm/oauth2/v1/login-page",
);

url.searchParams.set("response_type", "code");
url.searchParams.set("client_id", clientId);
url.searchParams.set("redirect_uri", redirectUri);
//url.searchParams.set("state", state);

url.searchParams.set(
  "scope",
  "pvms.openapi.basic pvms.openapi.control",
);

url.searchParams.set("locale", "bg-BG");

console.log();
console.log("========== FusionSolar OAuth ==========");
console.log(url.toString());
console.log("=======================================");
console.log();

const response = await fetch(url, {
  redirect: "manual",
});

console.log("Status:", response.status);
console.log("Final URL:", response.url);
console.log();

for (const [k, v] of response.headers) {
  console.log(k, "=", v);
}

console.log();

const body = await response.text();

console.log(body.substring(0, 1000));