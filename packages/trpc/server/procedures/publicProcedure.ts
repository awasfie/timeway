import { errorConversionMiddleware } from "../middlewares/errorConversionMiddleware";
import perfMiddleware from "../middlewares/perfMiddleware";
import { procedure } from "../trpc";

const publicProcedure = procedure.use(perfMiddleware).use(errorConversionMiddleware);

export default publicProcedure;
