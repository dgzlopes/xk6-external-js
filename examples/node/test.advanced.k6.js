import ext from "k6/x/external_js";

export const options = {
  vus: 1,
  duration: "30s",
};

export default function () {
  console.log("Starting iteration with Node.js interop...");
  
  const result = ext.run("./lib.node.js", {
    payload: { user: "alice" },
    env: {
      THIS_IS_FROM_K6: "this_is_from_k6",
    },
    timeout: "5s",
    runtime: "node"
  });
  
  console.log("Received:", result.message);
  console.log("Page title:", result.title);
}
