function generateMaze(size) {
    return [
        [
            [true, true, true, true, true],
            [true, true, true, true, true],
            [true, true, true, true, true],
            [true, true, true, true, true],
            [true, true, true, true, true]
        ],
        [
            [true, true, true, true, true],
            [false,false,false,false,true],
            [true, true, true, false,true],
            [true, false,false,false,true],
            [true, true, true, true, true]
        ],
        [
            [true, true, true, true, true],
            [true, true, true, false,true],
            [true, true, true, true, true],
            [true, true, true, true, true],
            [true, true, true, true, true]
        ],
        [
            [true, true, true, true, true],
            [true, false,false,false,true],
            [true, false,true, true, true],
            [true, false,false,false,false],
            [true, true, true, true, true]
        ],
        [
            [true, true, true, true, true],
            [true, true, true, true, true],
            [true, true, true, true, true],
            [true, true, true, true, true],
            [true, true, true, true, true]
        ]
    ]
}