/**
 * Clears a group of InstancedMeshes that is about to be rebuilt, freeing the
 * GPU buffers three will not free on its own. Geometries and materials are
 * reused for the life of the page; only the meshes are thrown away, and three
 * ties two buffers to that discarded half:
 *
 * - A mesh's instance matrix is deleted only from its own `dispose` event, so
 *   detaching it from its group orphans the buffer.
 * - A per-instance attribute `setAttribute`d onto a *shared* geometry is deleted
 *   only from `geometry.dispose()`, which iterates the geometry's *current*
 *   attributes - so the one a rebuild replaces is already unreachable.
 *
 * Hence `geometries`: pass every geometry whose attributes this build will
 * replace, including one belonging to an object outside the group. Disposing a
 * geometry still in use is safe - the renderer re-registers it on the next frame
 * and re-uploads its attributes, a couple of dozen vertices for a box.
 */
export function clearInstanced(group, geometries = []) {
    for (const child of group.children) {
        if (child.isInstancedMesh) child.dispose();
    }
    group.remove(...group.children);
    for (const geometry of geometries) geometry.dispose();
}

export default clearInstanced;
