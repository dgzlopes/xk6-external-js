import js from "k6/x/js";

export const options = {
  vus: 1,
  duration: "5s",
};

export default function () {
  console.log("Starting iteration test with Node.js interop...");
  
  const result = js.run("./lib.node.js", {
    user: "alice",
  });

  console.log("Received token:", result.token);
}
