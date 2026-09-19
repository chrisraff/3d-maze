/**
 * Records the player's path through the maze and, on completion, shows it
 * as a rainbow-colored line.
 */
import * as THREE from 'three';
import { MeshLine, MeshLineMaterial } from './THREE.MeshLine.js';

export default class RunHistory {
    // pointSpacing controls both the record threshold and the interpolation
    // step for large jumps (teleports)
    constructor({ map, resolution, pointSpacing }) {
        this.pointSpacing = pointSpacing;
        this.positions = [];

        this.lineMaterial = new MeshLineMaterial({
            useMap: true,
            map: map,
            opacity: 1,
            resolution: resolution,
            sizeAttenuation: true,
            lineWidth: 0.01,
            vertexColors: true
        });
        this.line = new MeshLine(); // this is a geometry
        this.mesh = new THREE.Mesh(this.line, this.lineMaterial);

        this._tmpColor = new THREE.Color();
        this._tmpVector = new THREE.Vector3();
    }

    addTo(scene) {
        scene.add(this.mesh);
    }

    // MeshLine sizes the line in screen space, so the material has to be told
    // when the viewport changes or the trail keeps rendering at the width the
    // window had when it was constructed
    setResolution(width, height) {
        this.lineMaterial.resolution.set(width, height);
    }

    reset() {
        this.positions = [];
        this.line.geometry.dispose();
        this.mesh.visible = false;
    }

    // call every frame with the player position; records a point when the
    // player has moved far enough, interpolating over large jumps
    recordPosition(position) {
        if (this.positions.length != 0 &&
                this.positions[this.positions.length - 1].distanceToSquared(position) <= (0.1 * this.pointSpacing) ** 2)
            return;

        const newPosition = this._tmpVector.copy(position);

        let lastPos = this.positions.length > 0 ? this.positions[this.positions.length - 1] : position;
        let distance = lastPos.distanceTo(newPosition);
        let numPoints = Math.max(1, Math.ceil(distance / this.pointSpacing));

        // in case of long distances (e.g. teleportation), interpolate points so the line doesn't look broken
        for (let i = 0; i < numPoints; i++) {
            let t = numPoints > 1 ? i / (numPoints - 1) : 1;
            let interpolatedPos = new THREE.Vector3();
            interpolatedPos.lerpVectors(lastPos, newPosition, t);
            this.positions.push(interpolatedPos);
        }
    }

    // builds the colored line from the recorded path and makes it visible
    showCompletedTrail() {
        let historyVerts = new Float32Array(3 * this.positions.length);
        let historyCols = new Float32Array(6 * this.positions.length);

        for (let i = 0; i < this.positions.length; i++) {
            historyVerts[i*3 + 0] = this.positions[i].x;
            historyVerts[i*3 + 1] = this.positions[i].y;
            historyVerts[i*3 + 2] = this.positions[i].z;

            this._tmpColor.setHSL(i / this.positions.length, 1.0, 0.75);

            historyCols[ i*6 + 0 ] = this._tmpColor.r;
            historyCols[ i*6 + 1 ] = this._tmpColor.g;
            historyCols[ i*6 + 2 ] = this._tmpColor.b;
            historyCols[ i*6 + 0+3 ] = this._tmpColor.r;
            historyCols[ i*6 + 1+3 ] = this._tmpColor.g;
            historyCols[ i*6 + 2+3 ] = this._tmpColor.b;
        }

        this.line.setPoints(historyVerts);
        this.line.setAttribute('color', new THREE.BufferAttribute(historyCols, 3));

        this.mesh.visible = true;
    }
}
