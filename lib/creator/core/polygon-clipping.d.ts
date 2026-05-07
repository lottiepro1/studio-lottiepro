declare module 'polygon-clipping' {
    type Ring = [number, number][];
    type Polygon = Ring[];
    type MultiPolygon = Polygon[];
    type Geom = Polygon | MultiPolygon;

    interface PolygonClipping {
        union(subject: Geom, ...clips: Geom[]): MultiPolygon;
        intersection(subject: Geom, ...clips: Geom[]): MultiPolygon;
        difference(subject: Geom, ...clips: Geom[]): MultiPolygon;
        xor(subject: Geom, ...clips: Geom[]): MultiPolygon;
    }

    const polygonClipping: PolygonClipping;
    export default polygonClipping;
}
