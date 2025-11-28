export default function sampleUniformSphere() {

    let x12 = 1;
    let x22 = 1;
    let x1 = 0;
    let x2 = 0;

    while (x12 + x22 >= 1) {

        x1 = Math.random() * 2 - 1;
        x2 = Math.random() * 2 - 1;

        x12 = x1*x1;
        x22 = x2*x2;

    }

    let sqrroot = Math.sqrt(1 - x12 - x22);

    // Random radius for uniform volume
    let r = Math.cbrt(Math.random());

    return [
        r * (2 * x1 * sqrroot),
        r * (2 * x2 * sqrroot),
        r * (1 - 2 * (x12 + x22))
    ];

}
