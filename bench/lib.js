export const handler = async (ctx) => {
  return {
    message: `${ctx.payload.user}, hello from another runtime!`,
  };
};

