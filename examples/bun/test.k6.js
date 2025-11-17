import ext from "k6/x/external_js";

export const options = {
  vus: 1,
  duration: "5s",
};

export default function () {
  console.log("Starting iteration test with Bun interop...");
  
  const result = ext.run("./lib.bun.js", {
    user: "alice",
  });

  console.log("Received:", result.message);
  console.log("Hash:", result.hash);
}

