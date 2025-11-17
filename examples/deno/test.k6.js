import js from "k6/x/js";

export const options = {
  vus: 1,
  duration: "5s",
};

export default function () {
  console.log("Starting iteration test with Deno interop...");
  
  const result = js.run("./lib.deno.ts", {
    user: "alice",
    runtime: "deno"
  });

  console.log("Received:", result.message);
  console.log("Hash:", result.hash);
}

